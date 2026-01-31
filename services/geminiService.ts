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
const MODEL_TOOL_USE = 'gemini-3-flash-preview'; // Updated to 3.0 Flash for better tool stability
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
    // Tenta encontrar bloco JSON Markdown
    const markdownMatch = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (markdownMatch) {
        cleanText = markdownMatch[1].trim();
    }
    
    // Fallback: Tenta encontrar o primeiro { ou [ e o último } ou ]
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
    Task: Search specifically for a relevant YouTube video URL about: "${query}".
    
    INSTRUCTIONS:
    1. Use the search tool to find a YouTube video (watch URL).
    2. Prefer high-quality content (news, official channels, educational).
    3. MANDATORY: Return a JSON object.
    
    Response format (JSON only): 
    { 
      "title": "Video Title", 
      "channel": "Channel Name", 
      "url": "https://www.youtube.com/watch?v=VIDEO_ID", 
      "caption": "Legenda jornalística em português.", 
      "altText": "Descrição acessível do vídeo em português." 
    }
  `;

  try {
      // Use gemini-3-flash-preview for tools as per guidelines
      const response = await retryWithBackoff(() => generateSmartContent(MODEL_TOOL_USE, prompt, { tools: [{ googleSearch: {} }] }));
      
      let result: any;
      try {
          result = cleanAndParseJSON(response.text);
      } catch (e) {
          console.warn("JSON Parse failed, attempting fallback regex extract", e);
          // Fallback: extract URL from text if JSON fails. Try to capture any youtube link.
          const urlMatch = response.text?.match(/https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/);
          if (urlMatch) {
              result = {
                  title: query,
                  channel: "YouTube",
                  url: urlMatch[0],
                  caption: `Vídeo sobre ${query}`,
                  altText: `Vídeo sobre ${query}`
              };
          } else {
             throw new Error("Could not parse JSON or find URL in text.");
          }
      }
      
      if (!result.url || result.url.includes("VIDEO_ID")) throw new Error("No valid URL found for the video.");

      // Regex atualizado para suportar youtube.com/shorts/, youtu.be, e youtube.com/watch
      // [\w-] captures alphanumeric plus underscore and hyphen, which covers YouTube IDs.
      const regExp = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})/;
      const match = result.url.match(regExp);
      const videoId = match ? match[1] : null;

      if (videoId) {
         const embedTitle = result.altText || result.title;
         return {
            query: query,
            title: result.title || "Video",
            channel: result.channel || "YouTube",
            url: result.url,
            embedHtml: `<iframe width="100%" height="100%" src="https://www.youtube-nocookie.com/embed/${videoId}" title="${embedTitle}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`,
            thumbnailUrl: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
            caption: result.caption || `Assista ao vídeo sobre: ${query}`,
            altText: result.altText || `Vídeo explicativo sobre ${query}`
         };
      } else {
          throw new Error("Invalid YouTube URL format.");
      }
  } catch (error) {
      console.error("Failed to find video:", error);
      throw error;
  }
};

export const injectVideoIntoHtml = (html: string, videoData?: VideoData): string => {
    if (!videoData || !videoData.embedHtml) return html;

    const videoSection = `
<div id="featured-video-container" class="video-container my-8">
  <h3 class="text-lg font-bold mb-2 flex items-center gap-2">
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-red-600"><rect width="20" height="15" x="2" y="7" rx="2" ry="2"/><polyline points="17 12 12 7 12 17"/></svg>
    Assista: ${videoData.title}
  </h3>
  <div class="aspect-video bg-slate-100 rounded-xl overflow-hidden shadow-sm">
    ${videoData.embedHtml}
  </div>
  ${videoData.caption ? `<p class="text-sm text-slate-500 mt-2 italic">${videoData.caption}</p>` : ''}
</div><!-- video-end -->`;

    // Remove existing if present to avoid dupes during re-runs or manual adds
    let cleanHtml = html.replace(/<div id="featured-video-container"[\s\S]*?<!-- video-end -->/g, '');

    // Logic to insert: 
    // 1. After first paragraph (lead)
    const leadCloseIndex = cleanHtml.indexOf('</p>');
    if (leadCloseIndex !== -1) {
        return cleanHtml.slice(0, leadCloseIndex + 4) + "\n" + videoSection + cleanHtml.slice(leadCloseIndex + 4);
    }
    
    // 2. Fallback: After H1
    const h1CloseIndex = cleanHtml.indexOf('</h1>');
    if (h1CloseIndex !== -1) {
        return cleanHtml.slice(0, h1CloseIndex + 5) + "\n" + videoSection + cleanHtml.slice(h1CloseIndex + 5);
    }

    // 3. Fallback: Top of article content
    return videoSection + "\n" + cleanHtml;
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
    
    INSTRUÇÃO E-E-A-T (MUITO IMPORTANTE - REFERÊNCIAS EXTERNAS):
    Ao final do artigo (antes da conclusão), crie uma seção OBRIGATÓRIA contendo 3 links para sites de ALTA AUTORIDADE EXTERNOS (Ex: Grandes Portais de Notícias, Wikipedia, Sites Governamentais, Universidades).
    NÃO coloque links para o site "${siteUrl || 'do usuário'}" nesta lista. Devem ser fontes EXTERNAS para dar credibilidade e validação.
    
    Use este formato HTML exato para as referências:
    <h3>🎓 Referências de Autoridade (Acesso Direto)</h3>
    <ol>
       <li><strong>Nome da Fonte Externa</strong>: <a href="URL_REAL_EXTERNA" target="_blank" rel="noopener nofollow">Título ou descrição do artigo citado</a></li>
       <li><strong>Nome da Fonte Externa</strong>: <a href="URL_REAL_EXTERNA" target="_blank" rel="noopener nofollow">Título ou descrição do artigo citado</a></li>
       <li><strong>Nome da Fonte Externa</strong>: <a href="URL_REAL_EXTERNA" target="_blank" rel="noopener nofollow">Título ou descrição do artigo citado</a></li>
    </ol>
    
    Retorne APENAS HTML dentro de <div class="artigogenio-content"><article>... </article></div>.
  `;

  try {
      const response = await generateSmartContent(
          MODEL_PRIMARY_TEXT, 
          prompt, 
          { 
              thinkingConfig: { thinkingBudget: 1024 }, 
              maxOutputTokens: 8192,
              tools: [{ googleSearch: {} }] // Permite busca para encontrar URLs externas reais
          }
      );
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

export const generateMediaStrategy = async (title: string, keyword: string, language: string): Promise<{ videoData: VideoData | undefined, imageSpecs: ImageSpec[] }> => {
  try {
      const response = await generateSmartContent(
        MODEL_PRIMARY_TEXT,
        `Estratégia visual (JSON) para "${title}". 1 query video, 4 image specs.`,
        { responseMimeType: "application/json", responseSchema: { type: Type.OBJECT, properties: { videoSearchQuery: { type: Type.STRING }, imageSpecs: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { role: { type: Type.STRING }, aspectRatio: { type: Type.STRING }, prompt: { type: Type.STRING }, alt: { type: Type.STRING }, title: { type: Type.STRING }, caption: { type: Type.STRING }, filename: { type: Type.STRING }, url: { type: Type.STRING } } } } } } }
      );
      const strategy = cleanAndParseJSON(response.text);
      
      // AUTO-BUSCA DO VÍDEO
      let realVideoData: VideoData | undefined;
      try { 
          // Tenta encontrar o vídeo automaticamente, incluindo legenda e alt text
          realVideoData = await findRealYoutubeVideo(strategy.videoSearchQuery || title); 
      } catch (videoError) {
          console.warn("Falha ao buscar vídeo automaticamente", videoError);
          // Fallback vazio mas mantendo a query para busca manual
          realVideoData = { query: strategy.videoSearchQuery || title, title: "", channel: "", url: "", embedHtml: "" }; 
      }

      return { videoData: realVideoData, imageSpecs: strategy.imageSpecs || [] };
  } catch { 
      return { videoData: undefined, imageSpecs: [] }; 
  }
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
  
  // FIX: Iterate through all parts to find inlineData. The model might return text/metadata first.
  if (response.candidates?.[0]?.content?.parts) {
      for (const part of response.candidates[0].content.parts) {
          if (part.inlineData && part.inlineData.data) {
              return part.inlineData.data;
          }
      }
  }
  
  throw new Error("A IA não retornou dados de imagem válidos (inlineData missing).");
};

export const editGeneratedImage = async (base64Image: string, editPrompt: string): Promise<string> => {
  const ai = getClient();
  const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({ model: MODEL_IMAGE_FLASH, contents: [{ role: 'user', parts: [{ inlineData: { data: base64Image.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, ""), mimeType: 'image/jpeg' } }, { text: editPrompt }] }] }), 3, 3000);
  
  // FIX: Iterate through all parts to find inlineData.
  if (response.candidates?.[0]?.content?.parts) {
      for (const part of response.candidates[0].content.parts) {
          if (part.inlineData && part.inlineData.data) {
              return part.inlineData.data;
          }
      }
  }

  throw new Error("Falha ao editar imagem (dados inválidos retornados).");
};
