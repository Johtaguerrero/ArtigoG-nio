import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { AdvancedOptions, SerpAnalysisResult, VideoData, ImageSpec, SeoData, ImageModelType, ImageResolution, AspectRatio, Author, ArticleData } from "../types";
import { getBrowserApiKey } from "./storageService";

// Helper to get client with dynamic key
const getClient = () => {
  const apiKey = process.env.API_KEY || getBrowserApiKey();
  
  if (!apiKey) {
    console.error("API Key não encontrada.");
    throw new Error("Chave de API ausente. Vá em 'Configurações' e insira sua API Key.");
  }

  return new GoogleGenAI({ apiKey });
};

// Configuração de Modelos
const MODEL_PRIMARY_TEXT = 'gemini-3-flash-preview'; 
const MODEL_FALLBACK_TEXT = 'gemini-flash-latest'; 
const MODEL_IMAGE_FLASH = 'gemini-2.5-flash-image';
const MODEL_IMAGE_PRO = 'gemini-3-pro-image-preview';

// --- SYSTEM PERSONA ---
const ARTIGO_GENIO_PERSONA = `
Você é o **ArtigoGênio AI**, um editor-chefe sênior especializado em:
• SEO Google 2025 & Google News (Top Stories)
• E-E-A-T (Experience, Expertise, Authority, Trust)
• HTML Semântico para WordPress
• Conteúdo viral, útil e indexável
• Tom de voz: Profissional, autoritário, mas acessível (Jornalismo de alto nível).

SEMPRE siga estas regras:
1. Palavra-chave DEVE aparecer nos primeiros 100 caracteres e no H1.
2. Densidade da palavra-chave entre 0.8% e 1.2%.
3. Hierarquia rigorosa (H1 único -> H2 -> H3).
4. Parágrafos curtos e escaneáveis.
`;

// --- HELPERS ---

const cleanAndParseJSON = (text: string | undefined): any => {
    if (!text || !text.trim()) {
        throw new Error("A IA retornou uma resposta vazia (sem conteúdo).");
    }

    let cleanText = text.trim();
    const markdownMatch = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (markdownMatch) {
        cleanText = markdownMatch[1].trim();
    }
    
    const firstBrace = cleanText.indexOf('{');
    const firstBracket = cleanText.indexOf('[');
    let start = -1;
    if (firstBrace !== -1 && firstBracket !== -1) start = Math.min(firstBrace, firstBracket);
    else if (firstBrace !== -1) start = firstBrace;
    else start = firstBracket;

    const lastBrace = cleanText.lastIndexOf('}');
    const lastBracket = cleanText.lastIndexOf(']');
    let end = -1;
    if (lastBrace !== -1 && lastBracket !== -1) end = Math.max(lastBrace, lastBracket);
    else if (lastBrace !== -1) end = lastBrace;
    else end = lastBracket;
    
    if (start !== -1 && end !== -1 && end > start) {
        cleanText = cleanText.substring(start, end + 1);
    }

    try {
        return JSON.parse(cleanText);
    } catch (e) {
        console.error("Falha ao fazer parse do JSON.", text);
        throw new Error("A resposta da IA não é um JSON válido. Tente novamente.");
    }
};

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries = 3,
  delay = 3000,
  factor = 2
): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const isRetryable = 
      error?.status === 429 || 
      error?.status === 503 || 
      (error?.message && (error.message.includes('429') || error.message.includes('overloaded') || error.message.includes('fetch') || error.message.includes('quota')));

    if (retries > 0 && isRetryable) {
      await new Promise(resolve => setTimeout(resolve, delay));
      return retryWithBackoff(fn, retries - 1, delay * factor, factor);
    }
    throw error;
  }
}

async function generateSmartContent(
  model: string, 
  contents: any, 
  config: any,
  fallbackModel: string = MODEL_FALLBACK_TEXT
): Promise<GenerateContentResponse> {
  const ai = getClient();
  const runRequest = async (targetModel: string, targetConfig: any) => {
    return await ai.models.generateContent({ model: targetModel, contents, config: targetConfig });
  };

  try {
    return await retryWithBackoff(() => runRequest(model, config), 2, 2000);
  } catch (error: any) {
    const isRecoverableError = error?.status === 429 || error?.code === 429 || error?.status === 404 || error?.code === 404 || (error?.message && (error.message.includes('429') || error.message.includes('quota') || error.message.includes('RESOURCE_EXHAUSTED') || error.message.includes('NOT_FOUND'))) || error?.status === 503;

    if (isRecoverableError && model !== fallbackModel) {
      console.warn(`Modelo ${model} falhou. Fallback para ${fallbackModel}...`);
      const cleanConfig = { ...config };
      if (cleanConfig.thinkingConfig) delete cleanConfig.thinkingConfig;
      return await retryWithBackoff(() => runRequest(fallbackModel, cleanConfig), 2, 4000);
    }
    throw error;
  }
}

// --- CORE FUNCTIONS ---

export const findRealYoutubeVideo = async (query: string): Promise<VideoData> => {
  const prompt = `
    Context: You are a helpful news assistant.
    Task: Search specifically for a YouTube video URL about: "${query}".
    INSTRUCTIONS:
    1. Use the search tool to find a YouTube video.
    2. The URL MUST be a standard watch URL.
    3. Prefer high-quality, relevant content.
    Response format (JSON only): { "title": "Video Title", "channel": "Channel Name", "url": "https://www.youtube.com/watch?v=VIDEO_ID", "caption": "Brief description.", "altText": "Accessibility." }
  `;

  const response = await retryWithBackoff(() => generateSmartContent(MODEL_FALLBACK_TEXT, prompt, { tools: [{ googleSearch: {} }] }));
  const result = cleanAndParseJSON(response.text);
  
  if (!result.url) throw new Error("No URL found for the video.");

  const regExp = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
  const match = result.url.match(regExp);
  const videoId = match ? match[1] : null;

  if (videoId) {
     return {
        query: query,
        title: result.title || "Video",
        channel: result.channel || "YouTube",
        url: result.url,
        embedHtml: `<iframe width="100%" height="100%" src="https://www.youtube-nocookie.com/embed/${videoId}" title="${result.title}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`,
        thumbnailUrl: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
        caption: result.caption || `Assista ao vídeo: ${query}`,
        altText: result.altText || `Vídeo sobre ${query}`
     };
  } else {
      throw new Error("Invalid YouTube URL format.");
  }
};

export const analyzeSerp = async (keyword: string, language: string = 'Português'): Promise<SerpAnalysisResult> => {
  try {
    const result = await generateSmartContent(
        MODEL_PRIMARY_TEXT,
        `
        ${ARTIGO_GENIO_PERSONA}
        TAREFA: Análise SERP para "${keyword}". Idioma: ${language}.
        Retorne JSON: { "competitorTitles": [], "contentGaps": [], "questions": [], "lsiKeywords": [], "strategy": "..." }
        `,
        { tools: [{ googleSearch: {} }] }
    );
    return cleanAndParseJSON(result.text);
  } catch (error) {
    console.error("SERP Analysis failed", error);
    return { competitorTitles: [], contentGaps: [], questions: [], lsiKeywords: [], strategy: "Foque em conteúdo original." };
  }
};

export const generateArticleStructure = async (topic: string, keyword: string, serpData: SerpAnalysisResult, language: string): Promise<{ title: string; subtitle: string; lead: string }> => {
  try {
    const response = await generateSmartContent(
      MODEL_PRIMARY_TEXT,
      `${ARTIGO_GENIO_PERSONA}\nTAREFA: Estrutura para "${topic}" / "${keyword}". Idioma: ${language}. Título MÁXIMO 7 palavras. JSON { title, subtitle, lead }.`,
      { responseMimeType: "application/json", responseSchema: { type: Type.OBJECT, properties: { title: { type: Type.STRING }, subtitle: { type: Type.STRING }, lead: { type: Type.STRING } } } }
    );
    return cleanAndParseJSON(response.text);
  } catch (error) {
    console.error("Structure generation error", error);
    throw error;
  }
};

export const generateMainContent = async (
  topic: string,
  keyword: string,
  structure: { title: string; lead: string },
  serpData: SerpAnalysisResult,
  wordCount: string,
  options: AdvancedOptions,
  language: string,
  siteUrl?: string,
  authorName?: string
): Promise<string> => {
  
  let internalLinksBlock = "";
  
  // 1. Lógica de Busca de Links Internos
  if (siteUrl && siteUrl.trim() !== '') {
    try {
        let domain = siteUrl.trim().replace(/^https?:\/\//, '');
        if (domain.endsWith('/')) domain = domain.slice(0, -1);
        
        console.log(`Buscando links internos em: ${domain}`);

        // Busca mais ampla para garantir resultados
        const linkSearchResponse = await generateSmartContent(
            MODEL_FALLBACK_TEXT,
            `Task: Find exactly 3 articles from the website "${domain}".
            Priority 1: Try to find articles vaguely related to "${keyword}".
            Priority 2: If no relevant matches, JUST RETURN ANY 3 RECENT OR POPULAR articles from "${domain}". 
            Convergence with title is NOT required. Just get links from the site.
            
            Query: "site:${domain}"
            
            Return JSON array: [{"title": "Article Title", "url": "https://${domain}/..."}]
            Ensure URLs belong to ${domain}. Max 3 items.`,
            { tools: [{ googleSearch: {} }] }
        );

        let foundLinks: any[] = [];
        try {
            foundLinks = cleanAndParseJSON(linkSearchResponse.text);
        } catch {
            // Regex Fallback
            const matches = linkSearchResponse.text?.match(/https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/g) || [];
            foundLinks = matches.filter(u => u.includes(domain)).map(u => ({ title: `Veja também`, url: u })).slice(0, 3);
        }

        if (Array.isArray(foundLinks) && foundLinks.length > 0) {
            // Garante estritamente 3 links, remove duplicatas de URL se houver
            const uniqueLinks = Array.from(new Map(foundLinks.map(item => [item.url, item])).values());
            const validLinks = uniqueLinks.filter(l => l.url && l.url.includes(domain)).slice(0, 3);

            if (validLinks.length > 0) {
                // BLOCO HTML EXATO COM ÍCONE E FORMATO DE LISTA
                internalLinksBlock = `
<div class="internal-links-section mt-8 mb-8">
  <h3 class="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">🎓 Leia também</h3>
  <ul class="space-y-2 list-disc pl-5 marker:text-slate-400">
    ${validLinks.map(l => `<li class="pl-1"><a href="${l.url}" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:underline font-medium hover:text-blue-800 transition-colors">${l.title}</a></li>`).join('')}
  </ul>
</div>`;
            }
        }
    } catch (e) { console.warn("Internal link search failed", e); }
  }

  // 2. Prompt Geração
  const prompt = `
    ${ARTIGO_GENIO_PERSONA}
    Escreva um Artigo SEO sobre "${topic}" (Keyword: "${keyword}"). Idioma: ${language}.
    H1 EXATO: "${structure.title}". Lead: "${structure.lead}".
    
    INSTRUÇÃO E-E-A-T (MUITO IMPORTANTE):
    Ao final do artigo (antes da conclusão), crie uma seção EXATAMENTE com este formato:
    
    <h3>🎓 Referências de Autoridade (Acesso Direto)</h3>
    <ol>
       <li>[Fonte 1]: <a href="#">Link</a></li>
       <li>[Fonte 2]: <a href="#">Link</a></li>
    </ol>
    
    Retorne APENAS HTML dentro de <div class="artigogenio-content"><article>... </article></div>.
  `;

  try {
      const response = await generateSmartContent(MODEL_PRIMARY_TEXT, prompt, { thinkingConfig: { thinkingBudget: 1024 }, maxOutputTokens: 8192 });
      let html = response.text || "";
      const markdownMatch = html.match(/```html([\s\S]*?)```/i) || html.match(/```([\s\S]*?)```/);
      if (markdownMatch) html = markdownMatch[1];
      html = html.replace(/<\/?(html|body|head)[^>]*>/gi, '').replace(/```/g, '').trim();

      // 3. INJEÇÃO PROGRAMÁTICA ROBUSTA
      if (internalLinksBlock) {
          const lowerHtml = html.toLowerCase();
          const refIndex = lowerHtml.lastIndexOf('</ol>');
          
          // Tenta injetar logo após as referências se existirem
          if (refIndex !== -1 && (lowerHtml.includes('referências') || lowerHtml.includes('referencias'))) {
               html = html.slice(0, refIndex + 5) + internalLinksBlock + html.slice(refIndex + 5);
          } 
          // Senão, tenta antes do fechamento do article
          else if (lowerHtml.includes('</article>')) {
               const articleEnd = lowerHtml.lastIndexOf('</article>');
               html = html.slice(0, articleEnd) + internalLinksBlock + html.slice(articleEnd);
          }
          // Fallback final: anexa ao fim
          else {
               html += internalLinksBlock;
          }
      }

      return html;
  } catch (error) {
     console.error("Main content error", error);
     throw error;
  }
};

export const generateMetadata = async (topic: string, keyword: string, htmlContent: string, language: string): Promise<SeoData> => {
    try {
        const response = await generateSmartContent(
            MODEL_PRIMARY_TEXT,
            `Gere SEO JSON para "${topic}". MetaDesc máx 156 chars. SeoTitle máx 60 chars.`,
            { responseMimeType: "application/json", responseSchema: { type: Type.OBJECT, properties: { seoTitle: { type: Type.STRING }, metaDescription: { type: Type.STRING }, slug: { type: Type.STRING }, targetKeyword: { type: Type.STRING }, synonyms: { type: Type.ARRAY, items: { type: Type.STRING } }, relatedKeyphrase: { type: Type.STRING }, tags: { type: Type.ARRAY, items: { type: Type.STRING } }, lsiKeywords: { type: Type.ARRAY, items: { type: Type.STRING } }, opportunities: { type: Type.OBJECT, properties: { featuredSnippet: { type: Type.STRING }, paa: { type: Type.ARRAY, items: { type: Type.STRING } }, googleNews: { type: Type.STRING } } } } } }
        );
        return cleanAndParseJSON(response.text);
    } catch (e) { 
        return { seoTitle: keyword, metaDescription: `Artigo sobre ${keyword}`, slug: keyword.replace(/ /g, '-'), targetKeyword: keyword, synonyms: [], relatedKeyphrase: "", tags: [], lsiKeywords: [], opportunities: { featuredSnippet: "", paa: [], googleNews: "" } };
    }
};

export const generateMediaStrategy = async (title: string, keyword: string, language: string): Promise<{ videoData: VideoData, imageSpecs: ImageSpec[] }> => {
  try {
      const response = await generateSmartContent(
        MODEL_PRIMARY_TEXT,
        `Estratégia visual (JSON) para "${title}". 1 query video, 4 image specs.`,
        { responseMimeType: "application/json", responseSchema: { type: Type.OBJECT, properties: { videoSearchQuery: { type: Type.STRING }, imageSpecs: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { role: { type: Type.STRING }, aspectRatio: { type: Type.STRING }, prompt: { type: Type.STRING }, alt: { type: Type.STRING }, title: { type: Type.STRING }, caption: { type: Type.STRING }, filename: { type: Type.STRING }, url: { type: Type.STRING } } } } } } }
      );
      const strategy = cleanAndParseJSON(response.text);
      let realVideoData: VideoData;
      try { realVideoData = await findRealYoutubeVideo(strategy.videoSearchQuery || title); } 
      catch { realVideoData = { query: title, title: "", channel: "", url: "", embedHtml: "" }; }
      return { videoData: realVideoData, imageSpecs: strategy.imageSpecs || [] };
  } catch { return { videoData: { query: title, title: "", channel: "", url: "", embedHtml: "" }, imageSpecs: [] }; }
};

export const generateTechnicalSeo = (article: ArticleData, author?: Author): { schemaJsonLd: string, wordpressPostJson: string } => {
    const now = new Date().toISOString();
    const siteUrl = article.siteUrl || "https://example.com";
    const permalink = `${siteUrl}/${article.seoData?.slug}`;
    const heroImage = article.imageSpecs?.find(i => i.role === 'hero');
    const imageUrl = heroImage?.url && !heroImage.url.startsWith('data:') ? heroImage.url : `${siteUrl}/default-image.jpg`;

    const schemaGraph = {
        "@context": "https://schema.org",
        "@graph": [
            { "@type": "Organization", "@id": `${siteUrl}/#organization`, "name": "ArtigoGênio Publisher", "url": siteUrl },
            { "@type": "WebSite", "@id": `${siteUrl}/#website`, "url": siteUrl, "publisher": { "@id": `${siteUrl}/#organization` } },
            { "@type": "ImageObject", "@id": `${permalink}/#primaryimage`, "url": imageUrl, "width": 1200, "height": 675 },
            { "@type": ["Article", "NewsArticle"], "@id": `${permalink}/#article`, "isPartOf": { "@id": permalink }, "author": { "@type": "Person", "name": author?.name || "Redação" }, "headline": article.seoData?.seoTitle, "datePublished": now, "dateModified": now, "mainEntityOfPage": { "@id": permalink }, "publisher": { "@id": `${siteUrl}/#organization` }, "image": { "@id": `${permalink}/#primaryimage` } }
        ]
    };

    const wpPayload = {
        title: article.title, content: article.htmlContent, status: "draft", slug: article.seoData?.slug, excerpt: article.seoData?.metaDescription,
        meta: { yoast_wpseo_title: article.seoData?.seoTitle, yoast_wpseo_metadesc: article.seoData?.metaDescription }
    };

    return { schemaJsonLd: JSON.stringify(schemaGraph, null, 2), wordpressPostJson: JSON.stringify(wpPayload, null, 2) };
};

export const generateImageFromPrompt = async (prompt: string, aspectRatio: AspectRatio = "1:1", model: ImageModelType = MODEL_IMAGE_FLASH, resolution: ImageResolution = '1K'): Promise<string> => {
  const ai = getClient();
  const config: any = { imageConfig: { aspectRatio: aspectRatio === '2:3' ? '3:4' : aspectRatio === '3:2' ? '4:3' : aspectRatio === '21:9' ? '16:9' : aspectRatio } };
  if (model === MODEL_IMAGE_PRO) config.imageConfig.imageSize = resolution;

  const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({ model: model, contents: { parts: [{ text: `${prompt} . Photorealistic, 8k.` }] }, config: config }), 3, 3000);
  if (response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data) return response.candidates[0].content.parts[0].inlineData.data;
  throw new Error("Falha ao gerar imagem.");
};

export const editGeneratedImage = async (base64Image: string, editPrompt: string): Promise<string> => {
  const ai = getClient();
  const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({ model: MODEL_IMAGE_FLASH, contents: [{ role: 'user', parts: [{ inlineData: { data: base64Image.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, ""), mimeType: 'image/jpeg' } }, { text: editPrompt }] }] }), 3, 3000);
  if (response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data) return response.candidates[0].content.parts[0].inlineData.data;
  throw new Error("Falha ao editar imagem.");
};
