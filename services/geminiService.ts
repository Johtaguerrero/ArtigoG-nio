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
// PRIMÁRIO: O modelo mais recente e capaz solicitado (Gemini 3 Flash Preview)
const MODEL_PRIMARY_TEXT = 'gemini-3-flash-preview'; 
// FALLBACK: Modelo estável (gemini-flash-latest alias) para evitar erros de 404/429
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

// Helper robusto para limpar e parsear JSON da IA
const cleanAndParseJSON = (text: string | undefined): any => {
    if (!text || !text.trim()) {
        throw new Error("A IA retornou uma resposta vazia (sem conteúdo).");
    }

    let cleanText = text.trim();

    // 1. Remove blocos de código markdown (```json ... ``` ou apenas ``` ... ```)
    const markdownMatch = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (markdownMatch) {
        cleanText = markdownMatch[1].trim();
    }
    
    // 2. Encontrar limites do JSON (Objeto {} ou Array [])
    const firstBrace = cleanText.indexOf('{');
    const firstBracket = cleanText.indexOf('[');
    
    let start = -1;
    
    if (firstBrace !== -1 && firstBracket !== -1) {
        start = Math.min(firstBrace, firstBracket);
    } else if (firstBrace !== -1) {
        start = firstBrace;
    } else {
        start = firstBracket;
    }

    const lastBrace = cleanText.lastIndexOf('}');
    const lastBracket = cleanText.lastIndexOf(']');
    
    let end = -1;

    if (lastBrace !== -1 && lastBracket !== -1) {
        end = Math.max(lastBrace, lastBracket);
    } else if (lastBrace !== -1) {
        end = lastBrace;
    } else {
        end = lastBracket;
    }
    
    if (start !== -1 && end !== -1 && end > start) {
        cleanText = cleanText.substring(start, end + 1);
    }

    try {
        return JSON.parse(cleanText);
    } catch (e) {
        console.error("Falha ao fazer parse do JSON. Texto recebido:", text);
        console.error("Texto limpo tentado:", cleanText);
        throw new Error("A resposta da IA não é um JSON válido. Tente novamente.");
    }
};

// Helper for rate limit handling with exponential backoff
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

/**
 * Função Wrapper Inteligente:
 * Tenta gerar com o modelo primário. Se der erro de cota (429) ou erro de modelo não encontrado (404), tenta com o fallback.
 */
async function generateSmartContent(
  model: string, 
  contents: any, 
  config: any,
  fallbackModel: string = MODEL_FALLBACK_TEXT
): Promise<GenerateContentResponse> {
  const ai = getClient();

  const runRequest = async (targetModel: string, targetConfig: any) => {
    return await ai.models.generateContent({
      model: targetModel,
      contents,
      config: targetConfig
    });
  };

  try {
    // Tentativa 1: Modelo Primário
    return await retryWithBackoff(() => runRequest(model, config), 2, 2000);
  } catch (error: any) {
    const isRecoverableError = 
      error?.status === 429 || 
      error?.code === 429 || 
      error?.status === 404 || 
      error?.code === 404 ||   
      (error?.message && error.message.includes('429')) ||
      (error?.message && error.message.includes('quota')) ||
      (error?.message && error.message.includes('RESOURCE_EXHAUSTED')) ||
      (error?.message && error.message.includes('NOT_FOUND')) ||
      error?.status === 503;

    if (isRecoverableError && model !== fallbackModel) {
      console.warn(`Modelo ${model} falhou (Erro ${error.status || error.code || 'Desconhecido'}). Tentando fallback para ${fallbackModel}...`);
      
      const cleanConfig = { ...config };
      if (cleanConfig.thinkingConfig) {
          delete cleanConfig.thinkingConfig;
      }

      return await retryWithBackoff(() => runRequest(fallbackModel, cleanConfig), 2, 4000);
    }
    throw error;
  }
}

// --- VIDEO SEARCH FUNCTION (Moved up to be accessible by generateMediaStrategy) ---

export const findRealYoutubeVideo = async (query: string): Promise<VideoData> => {
  const prompt = `
    Context: You are a helpful news assistant.
    Task: Search specifically for a YouTube video URL about: "${query}".
    
    INSTRUCTIONS:
    1. Use the search tool to find a YouTube video.
    2. The URL MUST be a standard watch URL: "https://www.youtube.com/watch?v=..."
    3. Prefer high-quality, relevant content (news, educational, official channels).
    4. Do NOT return channel URLs or playlist URLs.
    
    Response format (JSON only):
    {
      "title": "Video Title",
      "channel": "Channel Name",
      "url": "https://www.youtube.com/watch?v=VIDEO_ID",
      "caption": "Brief description of the video context.",
      "altText": "Accessibility description."
    }
  `;

  // Use retry logic for robustness
  // FIX: responseMimeType cannot be used with tools
  const response = await retryWithBackoff(() => generateSmartContent(
    MODEL_FALLBACK_TEXT, // Use Flash for speed and reliability with tools
    prompt,
    {
      tools: [{ googleSearch: {} }]
    }
  ));

  const result = cleanAndParseJSON(response.text);
  
  if (!result.url) throw new Error("No URL found for the video.");

  const regExp = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
  const match = result.url.match(regExp);
  const videoId = match ? match[1] : null;

  let embedHtml = "";
  let thumbnailUrl = "";

  if (videoId) {
     embedHtml = `<iframe width="100%" height="100%" src="https://www.youtube-nocookie.com/embed/${videoId}" title="${result.title}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
     thumbnailUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
  } else {
      throw new Error("Invalid YouTube URL format.");
  }

  return {
    query: query,
    title: result.title || "Video",
    channel: result.channel || "YouTube",
    url: result.url,
    embedHtml: embedHtml,
    thumbnailUrl: thumbnailUrl,
    caption: result.caption || `Assista ao vídeo: ${query}`,
    altText: result.altText || `Vídeo sobre ${query}`
  };
};

// --- CORE GENERATION FUNCTIONS ---

export const analyzeSerp = async (keyword: string, language: string = 'Português'): Promise<SerpAnalysisResult> => {
  try {
    const result = await generateSmartContent(
        MODEL_PRIMARY_TEXT,
        `
        ${ARTIGO_GENIO_PERSONA}
        TAREFA: Realizar análise SERP Profunda para a palavra-chave: "${keyword}".
        Idioma: ${language}.
        
        Você DEVE retornar um JSON válido com a seguinte estrutura:
        {
          "competitorTitles": ["Titulo 1", "Titulo 2", "Titulo 3"],
          "contentGaps": ["Lacuna 1", "Lacuna 2"],
          "questions": ["Pergunta 1", "Pergunta 2"],
          "lsiKeywords": ["Keyword 1", "Keyword 2"],
          "strategy": "Sua estratégia aqui"
        }
        
        Retorne APENAS o JSON.
        `,
        {
            tools: [{ googleSearch: {} }]
        }
    );

    return cleanAndParseJSON(result.text);

  } catch (error) {
    console.error("SERP Analysis failed", error);
    return {
      competitorTitles: [],
      contentGaps: [],
      questions: [],
      lsiKeywords: [],
      strategy: "Foque em conteúdo original e profundidade."
    };
  }
};

export const generateArticleStructure = async (
  topic: string, 
  keyword: string,
  serpData: SerpAnalysisResult,
  language: string
): Promise<{ title: string; subtitle: string; lead: string }> => {
  const prompt = `
    ${ARTIGO_GENIO_PERSONA}
    TAREFA: Baseado no tópico "${topic}" e keyword "${keyword}", gere a estrutura.
    Idioma: ${language}.
    Contexto: ${serpData.competitorTitles.join(', ')}.
    
    REGRAS CRÍTICAS DE TÍTULO (IMPORTANTE):
    1. O título (title) DEVE ter no MÁXIMO 7 palavras.
    2. Exemplo Bom: "Energia Solar: O Futuro do Brasil" (6 palavras).
    3. Exemplo Ruim: "Tudo o que você precisa saber sobre a Energia Solar no Brasil em 2025" (14 palavras).
    
    JSON com title, subtitle, lead.
  `;

  try {
    const response = await generateSmartContent(
      MODEL_PRIMARY_TEXT,
      prompt,
      {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            subtitle: { type: Type.STRING },
            lead: { type: Type.STRING }
          }
        }
      }
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
  
  let internalLinksContext = "";
  
  if (siteUrl && siteUrl.trim() !== '') {
    try {
        let domain = siteUrl.trim();
        domain = domain.replace(/^https?:\/\//, '');
        if (domain.endsWith('/')) domain = domain.slice(0, -1);
        
        console.log(`Buscando links internos em: ${domain} para o tópico: ${keyword}`);

        const linkSearchResponse = await generateSmartContent(
            MODEL_PRIMARY_TEXT,
            `
            Role: SEO Specialist.
            Task: Search specifically for 3 relevant articles on the website "${domain}" related to the keyword "${keyword}".
            Query to use: "site:${domain} ${keyword}"
            
            Return ONLY a JSON array of objects with keys: 'title' and 'url'.
            Example: [{"title": "Artigo 1", "url": "https://${domain}/artigo-1"}]
            Ensure URLs belong to ${domain}.
            `,
            { 
                tools: [{ googleSearch: {} }]
            },
            MODEL_FALLBACK_TEXT 
        );

        const foundLinks = cleanAndParseJSON(linkSearchResponse.text);

        if (Array.isArray(foundLinks) && foundLinks.length > 0) {
            const validLinks = foundLinks.filter(l => l.url && l.url.includes(domain)).slice(0, 3);

            if (validLinks.length > 0) {
                internalLinksContext = `
                ---------------------------------------------------------
                !!! INSTRUÇÃO OBRIGATÓRIA DE LINKAGEM INTERNA (SEO) !!!
                
                Você DEVE incluir os seguintes 3 links internos no corpo do artigo.
                Não crie uma lista no final. Integre-os NATURALMENTE ao texto usando âncoras (anchor text) relevantes.
                
                LINKS A INSERIR:
                ${JSON.stringify(validLinks, null, 2)}
                ---------------------------------------------------------
                `;
                console.log("Links internos encontrados e injetados:", validLinks);
            }
        }
    } catch (e) { 
        console.warn("Internal link search failed or timed out", e); 
    }
  }

  const prompt = `
    ${ARTIGO_GENIO_PERSONA}
    
    Escreva um Artigo Completo SEO sobre "${topic}".
    Palavra-chave: "${keyword}".
    Idioma: ${language}.
    
    INSTRUÇÃO OBRIGATÓRIA DE TÍTULO (H1):
    1. O artigo deve começar com um tag <h1>.
    2. O conteúdo do <h1> deve ser EXATAMENTE: "${structure.title}".
    3. NÃO altere, NÃO aumente e NÃO adicione palavras ao H1. Mantenha o limite de 7 palavras definido na estrutura.

    Lead: "${structure.lead}"
    
    Keywords LSI: ${serpData.lsiKeywords.join(', ')}
    Perguntas PAA: ${serpData.questions.join(', ')}

    Opções: TOC=${options.includeToc}, Glossario=${options.includeGlossary}.
    
    ${internalLinksContext}

    Retorne APENAS HTML puro dentro de <div class="artigogenio-content"><article>... </article></div>.
    Sem markdown block.
  `;

  try {
      const response = await generateSmartContent(
        MODEL_PRIMARY_TEXT,
        prompt,
        { 
            thinkingConfig: { thinkingBudget: 1024 }, 
            maxOutputTokens: 8192, 
        } 
      );

      let html = response.text || "";
      const markdownMatch = html.match(/```html([\s\S]*?)```/i) || html.match(/```([\s\S]*?)```/);
      if (markdownMatch) html = markdownMatch[1];
      html = html.replace(/<\/?(html|body|head)[^>]*>/gi, '').replace(/```/g, '');

      return html.trim();
  } catch (error) {
     console.error("Main content generation error", error);
     throw error;
  }
};

export const generateMetadata = async (
    topic: string,
    keyword: string,
    htmlContent: string,
    language: string
): Promise<SeoData> => {
    try {
        const response = await generateSmartContent(
            MODEL_PRIMARY_TEXT,
            `Gere SEO JSON (yoast) para artigo "${topic}", keyword "${keyword}", idioma ${language}.
            
            REGRAS CRÍTICAS DE TAMANHO (OBRIGATÓRIO):
            1. metaDescription: DEVE ter no MÁXIMO 156 CARACTERES (letras/espaços). NÃO ultrapasse. Seja conciso.
            2. seoTitle: Máximo 60 caracteres.
            
            Exemplo Bom de Meta (140 chars): "Saiba tudo sobre Energia Solar. Descubra como economizar na conta de luz e valorizar seu imóvel com painéis fotovoltaicos em 2025."
            `,
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

    } catch (e) { console.error("Metadata gen failed", e); }
    
    // Fallback safe
    return {
        seoTitle: `${keyword}: Guia Completo`.substring(0, 60),
        metaDescription: `Saiba tudo sobre ${keyword}. Guia completo.`.substring(0, 156),
        slug: keyword.toLowerCase().replace(/ /g, '-'),
        targetKeyword: keyword,
        synonyms: [],
        relatedKeyphrase: "",
        tags: [],
        lsiKeywords: [],
        opportunities: { featuredSnippet: "", paa: [], googleNews: "" }
    };
};

export const generateMediaStrategy = async (
  title: string,
  keyword: string,
  language: string
): Promise<{ videoData: VideoData, imageSpecs: ImageSpec[] }> => {
  try {
      // 1. Ask LLM for Image Specs and a Video Search Query (Concept only)
      const response = await generateSmartContent(
        MODEL_PRIMARY_TEXT,
        `Estratégia visual (JSON) para "${title}". 
         1. Defina UM termo de busca exato para encontrar um bom video no YouTube sobre o tema (campo 'videoSearchQuery').
         2. Crie 4 specs de imagens (hero, social, feed, detail) com prompts em ingles e alt/caption em ${language}.
         `,
        {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              videoSearchQuery: { type: Type.STRING },
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
      const query = strategy.videoSearchQuery || title;

      // 2. Perform Real Video Search based on the LLM's query to avoid hallucinated URLs
      let realVideoData: VideoData;
      try {
          console.log("Searching for real video with query:", query);
          realVideoData = await findRealYoutubeVideo(query);
      } catch (err) {
          console.warn("Video search failed during strategy gen:", err);
          // Return empty video data to allow manual search later without breaking generation
          realVideoData = { query: query, title: "", channel: "", url: "", embedHtml: "" };
      }

      return {
          videoData: realVideoData,
          imageSpecs: strategy.imageSpecs || []
      };

  } catch (e) { 
      console.error("Media gen failed", e); 
      // Total Fallback
      return { videoData: { query: title, title: "", channel: "", url: "", embedHtml: "" }, imageSpecs: [] };
  }
};

export const generateTechnicalSeo = (
    article: ArticleData,
    author?: Author
): { schemaJsonLd: string, wordpressPostJson: string } => {
    
    const now = new Date().toISOString();
    const siteUrl = article.siteUrl || "https://example.com";
    const permalink = `${siteUrl}/${article.seoData?.slug}`;
    const authorName = author?.name || "Redação";
    const authorUrl = author?.photoUrl || "";
    
    const heroImage = article.imageSpecs?.find(i => i.role === 'hero');
    const imageUrl = heroImage?.url && !heroImage.url.startsWith('data:') ? heroImage.url : `${siteUrl}/default-image.jpg`;

    const schemaGraph = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "Organization",
                "@id": `${siteUrl}/#organization`,
                "name": "ArtigoGênio Publisher",
                "url": siteUrl,
                "logo": { "@type": "ImageObject", "url": `${siteUrl}/logo.png` }
            },
            {
                "@type": "WebSite",
                "@id": `${siteUrl}/#website`,
                "url": siteUrl,
                "name": "ArtigoGênio Site",
                "publisher": { "@id": `${siteUrl}/#organization` }
            },
            {
                "@type": "ImageObject",
                "@id": `${permalink}/#primaryimage`,
                "url": imageUrl,
                "width": 1200,
                "height": 675,
                "caption": heroImage?.caption || article.title
            },
            {
                "@type": "BreadcrumbList",
                "@id": `${permalink}/#breadcrumb`,
                "itemListElement": [
                    { "@type": "ListItem", "position": 1, "name": "Home", "item": siteUrl },
                    { "@type": "ListItem", "position": 2, "name": article.title }
                ]
            },
            {
                "@type": ["Article", "NewsArticle"],
                "@id": `${permalink}/#article`,
                "isPartOf": { "@id": permalink },
                "author": { "@type": "Person", "name": authorName, "url": authorUrl },
                "headline": article.seoData?.seoTitle || article.title,
                "datePublished": now,
                "dateModified": now,
                "mainEntityOfPage": { "@id": permalink },
                "publisher": { "@id": `${siteUrl}/#organization` },
                "image": { "@id": `${permalink}/#primaryimage` },
                "description": article.seoData?.metaDescription,
                "keywords": article.seoData?.tags?.join(", "),
                "inLanguage": article.language
            }
        ]
    };

    if (article.videoData && article.videoData.title) {
        (schemaGraph["@graph"] as any[]).push({
            "@type": "VideoObject",
            "name": article.videoData.title,
            "description": article.videoData.caption || `Video about ${article.topic}`,
            "thumbnailUrl": article.videoData.thumbnailUrl || imageUrl,
            "uploadDate": now,
            "contentUrl": article.videoData.url,
            "embedUrl": article.videoData.embedHtml?.match(/src="([^"]+)"/)?.[1] || article.videoData.url
        });
    }

    if (article.seoData?.opportunities?.paa?.length) {
        (schemaGraph["@graph"] as any[]).push({
            "@type": "FAQPage",
            "mainEntity": article.seoData.opportunities.paa.map(q => ({
                "@type": "Question",
                "name": q,
                "acceptedAnswer": { "@type": "Answer", "text": "Resposta detalhada disponível no conteúdo do artigo." }
            }))
        });
    }

    const wpPayload = {
        title: article.title,
        content: article.htmlContent,
        status: "draft",
        slug: article.seoData?.slug,
        excerpt: article.seoData?.metaDescription,
        categories: [1], 
        tags: article.seoData?.tags || [],
        meta: {
            yoast_wpseo_title: article.seoData?.seoTitle,
            yoast_wpseo_metadesc: article.seoData?.metaDescription,
            yoast_wpseo_focuskw: article.seoData?.targetKeyword,
            _yoast_wpseo_canonical: permalink
        }
    };

    return {
        schemaJsonLd: JSON.stringify(schemaGraph, null, 2),
        wordpressPostJson: JSON.stringify(wpPayload, null, 2)
    };
};

const mapAspectRatio = (ratio: AspectRatio): string => {
    switch (ratio) {
        case '2:3': return '3:4';
        case '3:2': return '4:3';
        case '21:9': return '16:9';
        default: return ratio;
    }
}

export const generateImageFromPrompt = async (
  prompt: string, 
  aspectRatio: AspectRatio = "1:1",
  model: ImageModelType = MODEL_IMAGE_FLASH,
  resolution: ImageResolution = '1K'
): Promise<string> => {
  const ai = getClient();
  const enhancedPrompt = `${prompt} . Professional photojournalism, realistic, 8k, highly detailed.`;

  const safeAspectRatio = mapAspectRatio(aspectRatio);
  const config: any = { imageConfig: { aspectRatio: safeAspectRatio } };
  
  if (model === MODEL_IMAGE_PRO) {
      config.imageConfig.imageSize = resolution;
  }

  const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
    model: model,
    contents: { parts: [{ text: enhancedPrompt }] },
    config: config
  }), 3, 3000);

  if (!response.candidates || response.candidates.length === 0) {
      throw new Error("A IA não retornou nenhuma imagem. Verifique sua API Key ou Cotas.");
  }
  
  const candidate = response.candidates[0];
  if (candidate.finishReason && candidate.finishReason !== 'STOP') {
      throw new Error(`Geração interrompida. Motivo: ${candidate.finishReason} (Possível filtro de segurança)`);
  }

  if (candidate.content?.parts) {
    for (const part of candidate.content.parts) {
      if (part.inlineData && part.inlineData.data) return part.inlineData.data;
    }
  }
  
  throw new Error("Nenhum dado de imagem encontrado na resposta.");
};

export const editGeneratedImage = async (
  base64Image: string,
  editPrompt: string
): Promise<string> => {
  const ai = getClient();
  const cleanBase64 = base64Image.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");

  const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
    model: MODEL_IMAGE_FLASH,
    contents: [
      {
        role: 'user',
        parts: [
            { inlineData: { data: cleanBase64, mimeType: 'image/jpeg' } },
            { text: editPrompt },
        ]
      }
    ],
  }), 3, 3000);

  if (response.candidates?.[0]?.content?.parts) {
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData && part.inlineData.data) return part.inlineData.data;
    }
  }

  throw new Error("Falha ao editar a imagem.");
};
