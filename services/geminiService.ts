import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { AdvancedOptions, SerpAnalysisResult, VideoData, ImageSpec, SeoData, ImageModelType, ImageResolution, AspectRatio, Author, ArticleData, YoutubePayload } from "../types";
import { getBrowserApiKey } from "./storageService";

// VARIÁVEL DE ESTADO GLOBAL (CIRCUIT BREAKER)
// Se true, paramos de tentar gerar imagens para economizar tempo do usuário
let GLOBAL_IMAGE_QUOTA_EXHAUSTED = false;

// Helper to get client with dynamic key
const getClient = () => {
  const apiKey = process.env.API_KEY || getBrowserApiKey();
  
  if (!apiKey) {
    console.error("API Key não encontrada.");
    throw new Error("Chave de API ausente. Vá em 'Configurações' e insira sua API Key.");
  }

  return new GoogleGenAI({ apiKey });
};

// Configuração de Modelos - ATUALIZADO PARA VERSÕES ESTÁVEIS E GUIDELINES
const MODEL_PRIMARY_TEXT = 'gemini-3-pro-preview'; // Para tarefas complexas de escrita e raciocínio
const MODEL_FALLBACK_TEXT = 'gemini-3-flash-preview'; // Para tarefas mais simples ou fallback
const MODEL_TOOL_USE = 'gemini-3-flash-preview'; // Para uso de ferramentas e busca rápida
const MODEL_IMAGE_FLASH = 'gemini-2.5-flash-image'; // Modelo padrão para geração rápida de imagens
const MODEL_IMAGE_BACKUP = 'gemini-2.5-flash-image'; // Fallback para imagens

// --- SYSTEM PERSONA ---
const ARTIGO_GENIO_PERSONA = `
Você é o **ArtigoGênio AI**, um editor técnico sênior.

MODO DE OPERAÇÃO:
1. Você é um GERADOR DE DADOS. APIs externas executam as ações.
2. Você prepara tudo de forma perfeita para execução.

REGRAS CRÍTICAS DE HTML (NÃO QUEBRAR):
• O HTML deve ser LIMPO e SEMÂNTICO.
• Não repetir blocos.
• Ter apenas UM <article>.
• Ter TOC (Sumário) apenas UMA vez.
• Não duplicar <nav class="toc">.
• Nunca conter JS comentado.
• Nunca aninhe <p> dentro de <p>.

SEO OBRIGATÓRIO:
• Palavra-chave nos primeiros 50 caracteres.
• H1 único.
• Densidade 0.8% – 1.2%.
• Links internos e externos obrigatórios.
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
  delay = 2000,
  factor = 2,
  isImageRequest = false
): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    // Detecta erros de cota (429) ou sobrecarga (503)
    const isQuotaError = 
      error?.status === 429 || 
      (error?.message && (error.message.includes('429') || error.message.includes('quota') || error.message.includes('RESOURCE_EXHAUSTED')));
      
    const isNetworkError = 
      error?.status === 503 || 
      (error?.message && (error.message.includes('overloaded') || error.message.includes('fetch')));

    if (isQuotaError && isImageRequest) {
        console.warn("🚫 Cota de imagem esgotada. Ativando Circuit Breaker.");
        GLOBAL_IMAGE_QUOTA_EXHAUSTED = true;
        throw error; // Não faz retry se for imagem, falha rápido para usar placeholder
    }

    if (retries > 0 && (isQuotaError || isNetworkError)) {
      // Se for erro de cota, espera MUITO mais (30s inicial conforme pedido pela API)
      const waitTime = isQuotaError ? Math.max(delay, 30000) : delay;
      
      console.warn(`⚠️ API Limit/Quota (${isQuotaError ? '429' : 'Network'}). Aguardando ${waitTime}ms... Tentativas restantes: ${retries}`);
      
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return retryWithBackoff(fn, retries - 1, delay * factor, factor, isImageRequest);
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
    // Tenta primeiro com o modelo principal e configurações otimizadas
    return await retryWithBackoff(() => runRequest(model, config), 2, 4000);
  } catch (error: any) {
    const isRecoverableError = error?.status === 429 || error?.code === 429 || error?.status === 404 || error?.code === 404 || (error?.message && (error.message.includes('429') || error.message.includes('quota') || error.message.includes('RESOURCE_EXHAUSTED') || error.message.includes('NOT_FOUND'))) || error?.status === 503;

    if (isRecoverableError && model !== fallbackModel) {
      console.warn(`Modelo ${model} falhou ou excedeu cota. Fallback para ${fallbackModel}...`);
      const cleanConfig = { ...config };
      // Remove configurações incompatíveis com modelos mais antigos se necessário
      if (cleanConfig.thinkingConfig) delete cleanConfig.thinkingConfig;
      if (cleanConfig.responseSchema) delete cleanConfig.responseSchema; 
      
      // Fallback espera 6s antes de tentar
      await new Promise(resolve => setTimeout(resolve, 6000));
      return await retryWithBackoff(() => runRequest(fallbackModel, cleanConfig), 2, 6000);
    }
    throw error;
  }
}

// --- CORE FUNCTIONS ---

export const findRealYoutubeVideo = async (query: string): Promise<VideoData> => {
  // Lógica mais robusta para vídeo
  const prompt = `
    Find a specific YouTube video relevant to: "${query}".
    
    CRITERIA:
    1. Prefer OFFICIAL content (News channels, Documentaries, TED Talks, Educational).
    2. Avoid low quality vlogs or clickbait.
    3. The video must be in Portuguese (if topic implies) or English with Portuguese relevance.
    
    OUTPUT:
    Return a JSON object with the video title, channel name, exact URL, a journalistic caption in Portuguese, and an accessibility alt text.
  `;

  try {
      const response = await retryWithBackoff(() => generateSmartContent(
        MODEL_TOOL_USE, 
        prompt, 
        { 
            tools: [{ googleSearch: {} }],
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    title: { type: Type.STRING },
                    channel: { type: Type.STRING },
                    url: { type: Type.STRING },
                    caption: { type: Type.STRING, description: "Jornalistic caption describing the video context in Portuguese." },
                    altText: { type: Type.STRING, description: "Accessibility description of the video thumbnail/content." }
                },
                required: ["title", "url", "caption"]
            }
        }
      ));
      
      let result: any;
      try {
          result = cleanAndParseJSON(response.text);
      } catch (e) {
          console.warn("Structured JSON failed, trying regex extraction.");
          const urlMatch = response.text?.match(/https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/);
          if (urlMatch) {
              result = {
                  title: query,
                  channel: "YouTube",
                  url: urlMatch[0],
                  caption: `Vídeo selecionado sobre: ${query}`,
                  altText: `Vídeo explicativo sobre ${query}`
              };
          } else {
             throw new Error("Could not find a valid YouTube URL in the response.");
          }
      }
      
      if (!result.url || (!result.url.includes("youtube.com") && !result.url.includes("youtu.be"))) {
          throw new Error("Invalid URL returned by AI.");
      }

      // Validação e Extração de ID Segura
      const regExp = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})/;
      const match = result.url.match(regExp);
      const videoId = match ? match[1] : null;

      if (videoId) {
         const embedTitle = result.altText || result.title || "Video Player";
         const safeEmbedHtml = `<iframe width="100%" height="100%" src="https://www.youtube-nocookie.com/embed/${videoId}" title="${embedTitle}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;

         return {
            query: query,
            title: result.title || "Vídeo Recomendado",
            channel: result.channel || "YouTube",
            url: result.url,
            embedHtml: safeEmbedHtml,
            thumbnailUrl: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
            caption: result.caption || `Assista: ${result.title}`,
            altText: result.altText || `Vídeo sobre ${query}`
         };
      } else {
          throw new Error("Invalid YouTube ID extracted.");
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

    let cleanHtml = html.replace(/<div id="featured-video-container"[\s\S]*?<!-- video-end -->/g, '');

    const leadCloseIndex = cleanHtml.indexOf('</p>');
    if (leadCloseIndex !== -1) {
        return cleanHtml.slice(0, leadCloseIndex + 4) + "\n" + videoSection + cleanHtml.slice(leadCloseIndex + 4);
    }
    
    const h1CloseIndex = cleanHtml.indexOf('</h1>');
    if (h1CloseIndex !== -1) {
        return cleanHtml.slice(0, h1CloseIndex + 5) + "\n" + videoSection + cleanHtml.slice(h1CloseIndex + 5);
    }

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
  
  if (siteUrl && siteUrl.trim() !== '') {
    try {
        let domain = siteUrl.trim().replace(/^https?:\/\//, '');
        if (domain.endsWith('/')) domain = domain.slice(0, -1);
        
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
            const matches = linkSearchResponse.text?.match(/https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/g) || [];
            foundLinks = matches.filter(u => u.includes(domain)).map(u => ({ title: `Veja também`, url: u })).slice(0, 3);
        }

        if (Array.isArray(foundLinks) && foundLinks.length > 0) {
            const uniqueLinks = Array.from(new Map(foundLinks.map(item => [item.url, item])).values());
            const validLinks = uniqueLinks.filter(l => l.url && l.url.includes(domain)).slice(0, 3);

            if (validLinks.length > 0) {
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

  const prompt = `
    ${ARTIGO_GENIO_PERSONA}
    Escreva um Artigo SEO sobre "${topic}" (Keyword: "${keyword}"). Idioma: ${language}.
    H1 EXATO: "${structure.title}". Lead: "${structure.lead}".
    
    REGRAS DE HTML (ESTRITAS):
    1. Retorne APENAS 1 <article> wrapper.
    2. Nunca aninhe <p> dentro de <p>.
    3. TOC (Sumário) deve ser gerado UMA VEZ. Não duplique.
    4. Não use markdown na saída final, apenas HTML puro.
    
    INSTRUÇÃO E-E-A-T (MUITO IMPORTANTE - REFERÊNCIAS EXTERNAS):
    Ao final do artigo (antes da conclusão), crie uma seção OBRIGATÓRIA contendo 3 links para sites de ALTA AUTORIDADE EXTERNOS.
    
    Use este formato HTML exato para as referências:
    <h3>🎓 Referências de Autoridade (Acesso Direto)</h3>
    <ol>
       <li><strong>Nome da Fonte Externa</strong>: <a href="URL_REAL_EXTERNA" target="_blank" rel="noopener nofollow">Título ou descrição do artigo citado</a></li>
       <li><strong>Nome da Fonte Externa</strong>: <a href="URL_REAL_EXTERNA" target="_blank" rel="noopener nofollow">Título ou descrição do artigo citado</a></li>
       <li><strong>Nome da Fonte Externa</strong>: <a href="URL_REAL_EXTERNA" target="_blank" rel="noopener nofollow">Título ou descrição do artigo citado</a></li>
    </ol>
    
    Retorne APENAS HTML.
  `;

  try {
      const response = await generateSmartContent(
          MODEL_PRIMARY_TEXT, 
          prompt, 
          { 
              thinkingConfig: { thinkingBudget: 1024 }, 
              maxOutputTokens: 8192,
              tools: [{ googleSearch: {} }]
          }
      );
      let html = response.text || "";
      const markdownMatch = html.match(/```html([\s\S]*?)```/i) || html.match(/```([\s\S]*?)```/);
      if (markdownMatch) html = markdownMatch[1];
      html = html.replace(/<\/?(html|body|head)[^>]*>/gi, '').replace(/```/g, '').trim();

      if (internalLinksBlock) {
          const lowerHtml = html.toLowerCase();
          const refIndex = lowerHtml.lastIndexOf('</ol>');
          
          if (refIndex !== -1 && (lowerHtml.includes('referências') || lowerHtml.includes('referencias'))) {
               html = html.slice(0, refIndex + 5) + internalLinksBlock + html.slice(refIndex + 5);
          } 
          else if (lowerHtml.includes('</article>')) {
               const articleEnd = lowerHtml.lastIndexOf('</article>');
               html = html.slice(0, articleEnd) + internalLinksBlock + html.slice(articleEnd);
          }
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
            `Gere SEO JSON para "${topic}". 
            MetaDesc máx 156 chars (informativa). 
            SeoTitle máx 60 chars.
            WordPressExcerpt máx 180 chars (VIRAL, instigante, para atrair cliques).`,
            { 
                responseMimeType: "application/json", 
                responseSchema: { 
                    type: Type.OBJECT, 
                    properties: { 
                        seoTitle: { type: Type.STRING }, 
                        metaDescription: { type: Type.STRING }, 
                        slug: { type: Type.STRING }, 
                        targetKeyword: { type: Type.STRING }, 
                        synonyms: { type: Type.ARRAY, items: { type: Type.STRING } }, 
                        relatedKeyphrase: { type: Type.STRING }, 
                        tags: { type: Type.ARRAY, items: { type: Type.STRING } }, 
                        lsiKeywords: { type: Type.ARRAY, items: { type: Type.STRING } }, 
                        wordpressExcerpt: { type: Type.STRING, description: "Resumo viral e instigante de até 180 caracteres para WordPress, focado em alta taxa de clique (CTR)." },
                        opportunities: { 
                            type: Type.OBJECT, 
                            properties: { 
                                featuredSnippet: { type: Type.STRING }, 
                                paa: { type: Type.ARRAY, items: { type: Type.STRING } }, 
                                googleNews: { type: Type.STRING } 
                            } 
                        } 
                    } 
                } 
            }
        );
        return cleanAndParseJSON(response.text);
    } catch (e) { 
        return { seoTitle: keyword, metaDescription: `Artigo sobre ${keyword}`, slug: keyword.replace(/ /g, '-'), targetKeyword: keyword, synonyms: [], relatedKeyphrase: "", tags: [], lsiKeywords: [], opportunities: { featuredSnippet: "", paa: [], googleNews: "" } };
    }
};

export const generateMediaStrategy = async (title: string, keyword: string, language: string): Promise<{ videoData: VideoData | undefined, imageSpecs: ImageSpec[] }> => {
  try {
      const prompt = `
      Create a Media Strategy (JSON) for "${title}".
      
      Part 1: Youtube Strategy.
      Do NOT access YouTube directly.
      Generate a 'youtube' object with:
      - search_query: Ideal search term for external system.
      - criteria: { language, min_views, max_duration }
      - embed_template: "https://www.youtube-nocookie.com/embed/{{VIDEO_ID}}"
      
      Part 2: Image Specs.
      Generate 4 image specs.
      `;

      const response = await generateSmartContent(
        MODEL_PRIMARY_TEXT,
        prompt,
        { 
            responseMimeType: "application/json", 
            responseSchema: { 
                type: Type.OBJECT, 
                properties: { 
                    youtube: { 
                        type: Type.OBJECT, 
                        properties: {
                            search_query: { type: Type.STRING },
                            criteria: { 
                                type: Type.OBJECT,
                                properties: {
                                    language: { type: Type.STRING },
                                    min_views: { type: Type.INTEGER },
                                    max_duration: { type: Type.STRING }
                                }
                            },
                            embed_template: { type: Type.STRING }
                        }
                    }, 
                    imageSpecs: { 
                        type: Type.ARRAY, 
                        items: { 
                            type: Type.OBJECT, 
                            properties: { 
                                role: { type: Type.STRING }, 
                                aspectRatio: { type: Type.STRING }, 
                                prompt: { type: Type.STRING }, 
                                alt: { type: Type.STRING }, 
                                title: { type: Type.STRING }, 
                                caption: { type: Type.STRING }, 
                                filename: { type: Type.STRING }, 
                                url: { type: Type.STRING } 
                            } 
                        } 
                    } 
                } 
            } 
        }
      );
      const strategy = cleanAndParseJSON(response.text);
      
      let realVideoData: VideoData | undefined;
      
      if (strategy.youtube && strategy.youtube.search_query) {
          try { 
              realVideoData = await findRealYoutubeVideo(strategy.youtube.search_query); 
              realVideoData.strategyPayload = strategy.youtube; 
          } catch (videoError) {
              console.warn("Falha ao buscar vídeo automaticamente", videoError);
              realVideoData = { 
                  query: strategy.youtube.search_query, 
                  title: "", 
                  channel: "", 
                  url: "", 
                  embedHtml: "",
                  strategyPayload: strategy.youtube
              }; 
          }
      } else {
           realVideoData = { query: title, title: "", channel: "", url: "", embedHtml: "" }; 
      }

      return { videoData: realVideoData, imageSpecs: strategy.imageSpecs || [] };
  } catch (e) { 
      console.error("Media Strategy Error", e);
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

export const generateImageFromPrompt = async (prompt: string, aspectRatio: AspectRatio = "1:1", model: ImageModelType = 'gemini-2.5-flash-image', resolution: ImageResolution = '1K'): Promise<string> => {
  // CIRCUIT BREAKER: Se já falhou anteriormente por cota, nem tenta chamar a API
  if (GLOBAL_IMAGE_QUOTA_EXHAUSTED) {
      console.warn("Circuit Breaker Ativo: Retornando placeholder imediato.");
      const encodedText = encodeURIComponent(prompt.substring(0, 50));
      return `https://placehold.co/1200x800/1e293b/ffffff?text=${encodedText}...`;
  }

  const ai = getClient();
  
  // Mapeamento forçado para modelo estável se o usuário escolheu o antigo
  let actualModel = model;
  if (model === 'gemini-2.5-flash-image') {
      actualModel = MODEL_IMAGE_FLASH; // Usa o 'gemini-2.5-flash-image'
  }

  const config: any = { imageConfig: { aspectRatio: aspectRatio === '2:3' ? '3:4' : aspectRatio === '3:2' ? '4:3' : aspectRatio === '21:9' ? '16:9' : aspectRatio } };
  // Apenas Pro suporta Image Size
  if (actualModel.includes('pro')) {
      config.imageConfig.imageSize = resolution;
  }

  try {
      const response = await retryWithBackoff<GenerateContentResponse>(
          () => ai.models.generateContent({ model: actualModel, contents: { parts: [{ text: `${prompt} . Photorealistic, 8k.` }] }, config: config }), 
          1, // Apenas 1 retry se for imagem, pois quota não volta rápido
          4000, 
          2,
          true // Flag isImageRequest
      );
      
      if (response.candidates?.[0]?.content?.parts) {
          for (const part of response.candidates[0].content.parts) {
              if (part.inlineData && part.inlineData.data) {
                  return part.inlineData.data;
              }
          }
      }
      throw new Error("A IA não retornou dados de imagem válidos (inlineData missing).");
  } catch (error: any) {
      const msg = error.message || "";
      // Tratamento específico de erro de cota
      if (msg.includes("429") || msg.includes("quota") || msg.includes("RESOURCE_EXHAUSTED") || GLOBAL_IMAGE_QUOTA_EXHAUSTED) {
          console.warn(`Cota de imagem excedida (${actualModel}). Ativando placeholder.`);
          
          // Fallback para modelo de backup (uma última tentativa antes de desistir totalmente, se ainda não estivermos no backup)
          if (actualModel !== MODEL_IMAGE_BACKUP && !GLOBAL_IMAGE_QUOTA_EXHAUSTED) {
             try {
                 console.log(`Tentando modelo de backup: ${MODEL_IMAGE_BACKUP}`);
                 const backupRes = await ai.models.generateContent({ model: MODEL_IMAGE_BACKUP, contents: { parts: [{ text: prompt }] }, config });
                 // ... process backup result logic would go here, simplified for brevity to just placeholder on fail
             } catch(e) { /* ignore */ }
          }

          // Retorna URL de placeholder profissional
          const width = aspectRatio === '16:9' ? 1200 : 1024;
          const height = aspectRatio === '16:9' ? 675 : 1024;
          const encodedText = encodeURIComponent("Quota Exceeded - Placeholder");
          return `https://placehold.co/${width}x${height}/EEE/31343C?text=${encodedText}`;
      }
      throw error;
  }
};

export const editGeneratedImage = async (base64Image: string, editPrompt: string): Promise<string> => {
  if (GLOBAL_IMAGE_QUOTA_EXHAUSTED) throw new Error("Cota de imagem esgotada na sessão.");

  const ai = getClient();
  const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({ model: MODEL_IMAGE_FLASH, contents: [{ role: 'user', parts: [{ inlineData: { data: base64Image.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, ""), mimeType: 'image/jpeg' } }, { text: editPrompt }] }] }), 3, 3000, 2, true);
  
  if (response.candidates?.[0]?.content?.parts) {
      for (const part of response.candidates[0].content.parts) {
          if (part.inlineData && part.inlineData.data) {
              return part.inlineData.data;
          }
      }
  }

  throw new Error("Falha ao editar imagem (dados inválidos retornados).");
};