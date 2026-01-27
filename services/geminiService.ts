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
// PRIMÁRIO: O modelo mais recente e capaz solicitado
const MODEL_PRIMARY_TEXT = 'gemini-3-flash-preview'; 
// FALLBACK: Modelo estável com limites de cota maiores (Gemini 2.0 Flash)
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

/**
 * Função Wrapper inteligente que tenta o modelo primário e, 
 * se falhar por Cota (429) ou Sobrecarga (503), tenta o modelo de fallback.
 */
async function generateSmartContent(
  model: string, 
  contents: any, 
  config: any,
  fallbackModel: string = MODEL_FALLBACK_TEXT
): Promise<GenerateContentResponse> {
  const ai = getClient();

  const runRequest = async (targetModel: string) => {
    return await ai.models.generateContent({
      model: targetModel,
      contents,
      config
    });
  };

  try {
    // Tentativa 1: Modelo Primário (Gemini 3)
    return await retryWithBackoff(() => runRequest(model), 2, 1000);
  } catch (error: any) {
    // Verifica se é erro de Cota (429) ou Serviço Indisponível (503)
    const isQuotaOrLoadError = 
      error?.status === 429 || 
      error?.code === 429 || 
      (error?.message && error.message.includes('429')) ||
      (error?.message && error.message.includes('quota')) ||
      (error?.message && error.message.includes('RESOURCE_EXHAUSTED')) ||
      error?.status === 503;

    if (isQuotaOrLoadError && model !== fallbackModel) {
      console.warn(`Modelo ${model} falhou por cota/carga. Tentando fallback para ${fallbackModel}...`);
      // Tentativa 2: Modelo Fallback (Gemini Flash Estável)
      // Removemos configs específicas do Gemini 3 que podem não existir no anterior (ex: thinkingConfig se necessário, mas flash-latest suporta bem)
      const cleanConfig = { ...config };
      if (cleanConfig.thinkingConfig && fallbackModel.includes('1.5')) {
          delete cleanConfig.thinkingConfig; // Remove thinking se o fallback for muito antigo (não é o caso do flash-latest/2.0)
      }
      return await retryWithBackoff(() => runRequest(fallbackModel), 2, 2000);
    }
    throw error;
  }
}

// Helper for rate limit handling with exponential backoff
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries = 3,
  delay = 2000,
  factor = 2
): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const isRetryable = 
      error?.status === 429 || 
      error?.status === 503 || 
      (error?.message && (error.message.includes('429') || error.message.includes('overloaded') || error.message.includes('fetch')));

    if (retries > 0 && isRetryable) {
      await new Promise(resolve => setTimeout(resolve, delay));
      return retryWithBackoff(fn, retries - 1, delay * factor, factor);
    }
    throw error;
  }
}

export const analyzeSerp = async (keyword: string, language: string = 'Português'): Promise<SerpAnalysisResult> => {
  try {
    const result = await generateSmartContent(
        MODEL_PRIMARY_TEXT,
        `
        ${ARTIGO_GENIO_PERSONA}
        TAREFA: Realizar análise SERP Profunda para a palavra-chave: "${keyword}".
        Idioma: ${language}.
        Retorne um JSON com:
        1. Títulos dos 3 principais concorrentes.
        2. Lacunas de conteúdo.
        3. Perguntas PAA.
        4. Keywords LSI.
        5. Estratégia curta.
        `,
        {
            tools: [{ googleSearch: {} }],
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    competitorTitles: { type: Type.ARRAY, items: { type: Type.STRING } },
                    contentGaps: { type: Type.ARRAY, items: { type: Type.STRING } },
                    questions: { type: Type.ARRAY, items: { type: Type.STRING } },
                    lsiKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
                    strategy: { type: Type.STRING }
                }
            }
        }
    );

    if (result.text) {
      return JSON.parse(result.text) as SerpAnalysisResult;
    }
    throw new Error("No analysis generated");
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

    if (!response.text) throw new Error("Structure generation failed");
    return JSON.parse(response.text);
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
  
  // Internal link search (Auxiliary, can fail safely)
  let internalLinksContext = "";
  if (siteUrl) {
    try {
        const domain = siteUrl.replace(/^https?:\/\//, '').split('/')[0];
        const linkSearch = await generateSmartContent(
            MODEL_PRIMARY_TEXT,
            `Search site:${domain} for 3 articles related to "${keyword}". Return JSON list with 'title' and 'url'.`,
            { 
                tools: [{ googleSearch: {} }],
                responseMimeType: "application/json"
            }
        );
        const links = linkSearch.text ? JSON.parse(linkSearch.text) : [];
        if (Array.isArray(links) && links.length > 0) {
            internalLinksContext = `LINKS INTERNOS: ${JSON.stringify(links)}`;
        }
    } catch (e) { console.warn("Link search skipped", e); }
  }

  const prompt = `
    ${ARTIGO_GENIO_PERSONA}
    
    Escreva um Artigo Completo SEO sobre "${topic}".
    Palavra-chave: "${keyword}".
    Idioma: ${language}.
    H1: "${structure.title}"
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
            // Thinking budget ajuda na estruturação, mas se o modelo primário falhar,
            // o fallback (2.0) vai ignorar ou usar padrão.
            thinkingConfig: { thinkingBudget: 4096 }, 
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
            `Gere SEO JSON (yoast) para artigo "${topic}", keyword "${keyword}", idioma ${language}.`,
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

        if (response.text) return JSON.parse(response.text);
    } catch (e) { console.error("Metadata gen failed", e); }
    
    return {
        seoTitle: `${keyword}: Guia Completo`,
        metaDescription: `Saiba tudo sobre ${keyword}.`,
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
      const response = await generateSmartContent(
        MODEL_PRIMARY_TEXT,
        `Estratégia visual (JSON) para "${title}". 1 termo busca youtube. 4 specs imagens (hero, social, feed, detail) com prompts em ingles e alt/caption em ${language}.`,
        {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              videoData: {
                type: Type.OBJECT,
                properties: {
                  query: { type: Type.STRING },
                  title: { type: Type.STRING },
                  channel: { type: Type.STRING },
                  url: { type: Type.STRING },
                  embedHtml: { type: Type.STRING }
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

      if (response.text) return JSON.parse(response.text);
  } catch (e) { console.error("Media gen failed", e); }

  return { videoData: { query: keyword, title: "", channel: "", url: "", embedHtml: "" }, imageSpecs: [] };
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

export const generateImageFromPrompt = async (
  prompt: string, 
  aspectRatio: AspectRatio = "1:1",
  model: ImageModelType = MODEL_IMAGE_FLASH,
  resolution: ImageResolution = '1K'
): Promise<string> => {
  const ai = getClient();
  const enhancedPrompt = `${prompt} . Professional photojournalism, realistic, 8k, highly detailed.`;

  const config: any = { imageConfig: { aspectRatio: aspectRatio } };
  if (model === MODEL_IMAGE_PRO) config.imageConfig.imageSize = resolution;

  const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
    model: model,
    contents: { parts: [{ text: enhancedPrompt }] },
    config: config
  }), 3, 3000);

  if (response.candidates?.[0]?.content?.parts) {
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData && part.inlineData.data) return part.inlineData.data;
    }
  }
  
  throw new Error("No image data found");
};

export const editGeneratedImage = async (
  base64Image: string,
  editPrompt: string
): Promise<string> => {
  const ai = getClient();
  const cleanBase64 = base64Image.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");

  const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
    model: MODEL_IMAGE_FLASH,
    contents: {
      parts: [
        { inlineData: { data: cleanBase64, mimeType: 'image/jpeg' } },
        { text: editPrompt },
      ],
    },
  }), 3, 3000);

  if (response.candidates?.[0]?.content?.parts) {
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData && part.inlineData.data) return part.inlineData.data;
    }
  }

  throw new Error("Image edit failed");
};

export const findRealYoutubeVideo = async (query: string): Promise<VideoData> => {
  const prompt = `
    Find the most relevant YouTube video for the search query: "${query}".
    Return a JSON object with title, channel, url (valid youtube watch url), caption (journalistic in pt-br), altText.
  `;

  // Aqui usamos diretamente o fallback (Flash Stable) porque a busca do Google consome muita cota
  const response = await generateSmartContent(
    MODEL_FALLBACK_TEXT, 
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
          caption: { type: Type.STRING },
          altText: { type: Type.STRING }
        }
      }
    }
  );

  if (!response.text) throw new Error("Video search failed");
  
  const result = JSON.parse(response.text);
  if (!result.url) throw new Error("No URL found");

  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = result.url.match(regExp);
  const videoId = (match && match[2].length === 11) ? match[2] : null;

  let embedHtml = "";
  let thumbnailUrl = "";

  if (videoId) {
     embedHtml = `<iframe width="100%" height="100%" src="https://www.youtube-nocookie.com/embed/${videoId}" title="${result.title}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
     thumbnailUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
  }

  return {
    query: query,
    title: result.title || "Video",
    channel: result.channel || "YouTube",
    url: result.url,
    embedHtml: embedHtml,
    thumbnailUrl: thumbnailUrl,
    caption: result.caption || `Assista ao vídeo sobre ${query}`,
    altText: result.altText || `Vídeo do YouTube: ${result.title}`
  };
};