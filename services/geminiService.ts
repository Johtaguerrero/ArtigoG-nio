import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { AdvancedOptions, SerpAnalysisResult, VideoData, ImageSpec, SeoData, ImageModelType, ImageResolution, AspectRatio, Author, ArticleData } from "../types";
import { getBrowserApiKey } from "./storageService";

// Helper to get client with dynamic key
const getClient = () => {
  // 1. Tenta pegar do ambiente (seguro para deploy)
  // 2. Tenta pegar do armazenamento local (para testes rápidos ou correções manuais)
  const apiKey = process.env.API_KEY || getBrowserApiKey();
  
  if (!apiKey) {
    console.error("API Key não encontrada. Configure a variável de ambiente API_KEY ou insira nas Configurações do App.");
    throw new Error("Chave de API do Google ausente. Vá em 'Configurações' no menu lateral e cole sua chave API, ou configure a variável de ambiente.");
  }

  return new GoogleGenAI({ apiKey });
};

const MODEL_FLASH = 'gemini-3-flash-preview';
const MODEL_IMAGE_FLASH = 'gemini-2.5-flash-image';
const MODEL_IMAGE_PRO = 'gemini-3-pro-image-preview';

// Helper for rate limit handling with exponential backoff
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries = 4,
  delay = 2000,
  factor = 2
): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const isRateLimit = 
      error?.status === 429 || 
      error?.code === 429 || 
      (error?.message && error.message.includes('429')) ||
      (error?.message && error.message.includes('quota')) ||
      (error?.status === 'RESOURCE_EXHAUSTED') ||
      (error?.status === 503) || 
      (error?.message && error.message.includes('overloaded')) ||
      (error?.message && error.message.includes('UNAVAILABLE'));

    if (retries > 0 && isRateLimit) {
      console.warn(`Serviço ocupado (Quota/Overload). Tentando novamente em ${delay}ms... (${retries} tentativas restantes)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return retryWithBackoff(fn, retries - 1, delay * factor, factor);
    }
    throw error;
  }
}

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

export const analyzeSerp = async (keyword: string, language: string = 'Português'): Promise<SerpAnalysisResult> => {
  try {
    const ai = getClient();
    const result = await retryWithBackoff<GenerateContentResponse>(async () => {
        const response = await ai.models.generateContent({
            model: MODEL_FLASH,
            contents: `
            ${ARTIGO_GENIO_PERSONA}
            
            TAREFA: Realizar análise SERP Profunda para a palavra-chave: "${keyword}".
            Idioma: ${language}.
            
            Retorne um JSON com:
            1. Títulos dos 3 principais concorrentes (em ${language}).
            2. Lacunas de conteúdo (O que falta neles?).
            3. Perguntas "People Also Ask" (PAA) para usar em FAQ.
            4. Keywords LSI (Latent Semantic Indexing) para enriquecer o texto.
            5. Estratégia (Um parágrafo curto explicando como superar esses concorrentes via E-E-A-T e qualidade de conteúdo).
            `,
            config: {
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
        });
        return response;
    });

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
    
    TAREFA: Baseado no tópico "${topic}" e keyword "${keyword}", gere a estrutura inicial.
    Idioma de saída: ${language}.
    
    Contexto SERP (Superar estes): ${serpData.competitorTitles.join(', ')}.

    Requisitos:
    1. Title (H1): Máx 60 chars, deve conter a keyword no início ou meio. Alta taxa de clique (CTR).
    2. Subtitle: Engajador, máx 150 chars.
    3. Lead (Lide Jornalístico): A keyword "${keyword}" OBRIGATORIAMENTE deve aparecer nos primeiros 50-100 caracteres. Responda: O que, Quem, Quando, Onde, Por que.
    
    Formato JSON.
  `;

  try {
    const ai = getClient();
    const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
      model: MODEL_FLASH,
      contents: prompt,
      config: {
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
    }));

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
  
  const ai = getClient();
  
  // Internal linking strategy
  let internalLinksContext = "";
  if (siteUrl) {
    try {
        const domain = siteUrl.replace(/^https?:\/\//, '').split('/')[0];
        // Wrapped internal search with retry as well
        const linkSearch = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
            model: MODEL_FLASH,
            contents: `Search site:${domain} for 3 articles related to "${keyword}". Return JSON list with 'title' and 'url'.`,
            config: { 
                tools: [{ googleSearch: {} }],
                responseMimeType: "application/json"
            }
        }), 2, 1000); // fewer retries for this auxiliary task
        
        const links = linkSearch.text ? JSON.parse(linkSearch.text) : [];
        if (Array.isArray(links) && links.length > 0) {
            internalLinksContext = `
            LINKS INTERNOS OBRIGATÓRIOS:
            - Insira estes links naturalmente no texto âncora adequado.
            - Crie uma seção <section><h2>Veja Também</h2><ul> (ou tradução para ${language}) com a lista <ul> dos links.
            - Links: ${JSON.stringify(links)}
            `;
        }
    } catch (e) { console.warn("Internal link search failed or skipped", e); }
  }

  const prompt = `
    ${ARTIGO_GENIO_PERSONA}

    ========================================================
    0) ENTRADAS
    ========================================================
    tipo_artigo: Artigo Completo SEO
    tema: "${topic}"
    palavra_chave: "${keyword}"
    autor: "${authorName || 'Redação'}"
    tamanho_artigo: ${wordCount} palavras
    site_base: "${siteUrl || ''}"
    
    DADOS ESTRUTURAIS JÁ GERADOS (USE ESTES):
    H1: "${structure.title}"
    Lead: "${structure.lead}"
    
    DADOS SEO:
    Keywords LSI: ${serpData.lsiKeywords.join(', ')}
    Perguntas PAA: ${serpData.questions.join(', ')}

    opcoes_avancadas:
      incluir_sumario: ${options.includeToc}
      incluir_glossario: ${options.includeGlossary}
      incluir_tabelas: ${options.includeTables}
      incluir_listas: ${options.includeLists}
      fontes_seguras: ${options.secureSources}
      creditos_autores: ${options.authorCredits}
    
    ${internalLinksContext}

    ========================================================
    1) REGRAS CRÍTICAS (NÃO NEGOCIÁVEIS)
    ========================================================
    A) SAÍDA SEM DUPLICAÇÃO:
    - Gere APENAS 1 (um) bloco HTML final.
    - Proibido repetir wrappers (ex: <div class="artigogenio-content"> duplicado).
    - Proibido inserir placeholders e comentários HTML (ex: <!-- JS would generate TOC -->).
    - Proibido criar dois TOCs. TOC deve existir no máximo 1 vez, e só se incluir_sumario=true.

    B) SEO OBRIGATÓRIO:
    - A palavra-chave "${keyword}" deve aparecer nos primeiros 100 caracteres do lead.
    - Exatamente 1 H1 por artigo (já fornecido).
    - Densidade da palavra-chave alvo: 0.8% a 1.2%.
    - Texto escaneável: parágrafos curtos (máx. 4 linhas).

    C) HTML SEGURO PARA BASE44 (WORDPRESS):
    - Não use <script> nem <style>.
    - Garanta tags fechadas corretamente.
    - Use IDs únicos (kebab-case) em TODOS os H2/H3 quando TOC estiver ligado.

    ========================================================
    2) MONTAGEM DO HTML (MODELO OBRIGATÓRIO)
    ========================================================
    Você deve retornar UMA STRING contendo EXATAMENTE esta estrutura (preenchendo o conteúdo):

    <div class="artigogenio-content">
      <article>
        <header>
          <h1>${structure.title}</h1>
          <p class="lead text-lg text-slate-600 mb-8 font-medium">${structure.lead}</p>
        </header>

        ${options.includeToc ? `<nav class="toc bg-slate-50 p-6 rounded-lg mb-8 border border-slate-200" aria-label="Sumário">
          <h2 class="text-lg font-bold mb-4">Índice</h2>
          <ul>
            <!-- Gere os itens do índice (li > a[href]) apontando para os IDs das seções abaixo -->
          </ul>
        </nav>` : ''}

        <section id="introducao">
          <h2>Introdução</h2>
          <p>...</p>
        </section>

        <!-- GERE O CORPO DO ARTIGO AQUI COM VÁRIAS SECTIONS, H2, H3, P, UL, TABLE -->

        <section id="faq">
          <h2>Perguntas frequentes</h2>
          <!-- Responda as PAA aqui -->
        </section>

        ${options.includeGlossary ? `<section id="glossario">
          <h2>Glossário</h2>
          <dl>
            <!-- Termos e definições -->
          </dl>
        </section>` : ''}

        <footer id="autor" class="mt-8 pt-6 border-t border-slate-200">
          <p><strong>Escrito por:</strong> ${authorName || 'Redação'}</p>
          <p class="text-sm text-slate-500">Conteúdo revisado e otimizado para ${language}.</p>
        </footer>
      </article>
    </div>

    ========================================================
    3) SAÍDA FINAL
    ========================================================
    Retorne APENAS o código HTML puro (sem \`\`\`html ou \`\`\`).
    NÃO retorne JSON.
  `;

  try {
      const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
        model: MODEL_FLASH,
        contents: prompt,
        config: { 
            // Thinking budget ajuda a estruturar artigos longos e complexos
            thinkingConfig: { thinkingBudget: 4096 }, // Increased for complex HTML structure
            maxOutputTokens: 8192, 
        } 
      }));

      // NOTE: response.text is a property getter, not a function!
      let html = response.text || "";
      
      // LIMPEZA ROBUSTA PARA WORDPRESS
      const markdownMatch = html.match(/```html([\s\S]*?)```/i) || html.match(/```([\s\S]*?)```/);
      if (markdownMatch) {
          html = markdownMatch[1];
      }

      // Remover tags indesejadas externas se a IA alucinar e colocar html/body
      html = html.replace(/<\/?(html|body|head)[^>]*>/gi, '');
      html = html.replace(/```/g, '');

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
    const ai = getClient();
    const prompt = `
        ${ARTIGO_GENIO_PERSONA}
        
        Analise o artigo sobre "${topic}" e gere o SEO COMPLETO (YOAST / GOOGLE STANDARD).
        
        Palavra-chave foco: "${keyword}".
        Idioma: ${language}.
        
        REQUISITOS ESTRITOS (JSON):
        1. seoTitle: Máx 60 caracteres. A palavra-chave "${keyword}" DEVE estar no INÍCIO.
        2. metaDescription: Máx 156 caracteres. A palavra-chave "${keyword}" DEVE estar nos primeiros 100 caracteres. Deve ser persuasiva (CTA).
        3. slug: URL amigável, curta, hifenizada, sem stop-words.
        4. targetKeyword: A própria palavra-chave.
        5. synonyms: Exatamente 4 sinônimos relevantes encontrados no texto ou contexto.
        6. relatedKeyphrase: Uma frase-chave relacionada (cauda longa).
        7. tags: Exatamente 10 tags relevantes para WordPress.
        8. lsiKeywords: 5 palavras LSI usadas.
        9. opportunities: Objeto contendo:
           - featuredSnippet: Texto curto explicando como o artigo pode ganhar o snippet zero (ex: "Use uma lista no H2...").
           - paa: Lista de perguntas PAA abordadas.
           - googleNews: Sugestão de ângulo para Google News (Top Stories).
        
        Formato JSON.
    `;

    try {
        const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
            model: MODEL_FLASH,
            contents: prompt,
            config: {
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
        }));

        if (response.text) {
             return JSON.parse(response.text);
        }
    } catch (e) {
        console.error("Metadata generation failed", e);
    }
    
    // Fallback seguro
    return {
        seoTitle: `${keyword}: Guia Completo e Atualizado`,
        metaDescription: `Saiba tudo sobre ${keyword}. Confira este guia completo com as melhores informações, dicas e novidades atualizadas sobre o tema.`,
        slug: keyword.toLowerCase().replace(/ /g, '-'),
        targetKeyword: keyword,
        synonyms: [],
        relatedKeyphrase: "",
        tags: [],
        lsiKeywords: [],
        opportunities: {
            featuredSnippet: "",
            paa: [],
            googleNews: ""
        }
    };
};

export const generateMediaStrategy = async (
  title: string,
  keyword: string,
  language: string
): Promise<{ videoData: VideoData, imageSpecs: ImageSpec[] }> => {
  const ai = getClient();
  const prompt = `
    ${ARTIGO_GENIO_PERSONA}
    
    Crie a estratégia visual para o artigo: "${title}".
    
    1. VIDEO: Encontre o melhor termo de busca para YouTube em ${language}.
    
    2. IMAGENS (Fotojornalismo Profissional):
       Gere 4 especificações de imagem.
       - Prompt: EM INGLÊS (Midjourney style, highly detailed, photorealistic, cinematic lighting).
       - Roles: 'hero' (16:9), 'social' (1:1), 'feed' (3:4), 'detail' (4:3).
       - SEO COMPLETO OBRIGATÓRIO (em ${language}):
          - Alt text: Descritivo para acessibilidade e SEO (contendo keyword).
          - Title: Título informativo para tooltip.
          - Caption: Legenda jornalística explicativa para ir abaixo da imagem.
          - Filename: nome-do-arquivo-com-keyword.jpg (kebab-case, sem acentos).
       
    Retorne JSON.
  `;

  try {
      const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
        model: MODEL_FLASH,
        contents: prompt,
        config: {
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
      }));

      // NOTE: response.text is a property getter, not a function!
      if (response.text) {
          return JSON.parse(response.text);
      }
  } catch (e) {
      console.error("Media generation failed", e);
  }

  return {
      videoData: { query: keyword, title: "", channel: "", url: "", embedHtml: "" },
      imageSpecs: []
  };
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
    
    // 1. Construct Schema JSON-LD
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
                "logo": {
                    "@type": "ImageObject",
                    "url": `${siteUrl}/logo.png`
                }
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
                    {
                        "@type": "ListItem",
                        "position": 1,
                        "name": "Home",
                        "item": siteUrl
                    },
                    {
                        "@type": "ListItem",
                        "position": 2,
                        "name": article.title
                    }
                ]
            },
            {
                "@type": ["Article", "NewsArticle"],
                "@id": `${permalink}/#article`,
                "isPartOf": { "@id": permalink },
                "author": {
                    "@type": "Person",
                    "name": authorName,
                    "url": authorUrl
                },
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

    // Add VideoObject if available
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

    // Add FAQPage if PAA exists
    if (article.seoData?.opportunities?.paa?.length) {
        (schemaGraph["@graph"] as any[]).push({
            "@type": "FAQPage",
            "mainEntity": article.seoData.opportunities.paa.map(q => ({
                "@type": "Question",
                "name": q,
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "Resposta detalhada disponível no conteúdo do artigo." // Placeholder valid
                }
            }))
        });
    }

    // 2. Construct WordPress JSON
    const wpPayload = {
        title: article.title,
        content: article.htmlContent,
        status: "draft",
        slug: article.seoData?.slug,
        excerpt: article.seoData?.metaDescription,
        categories: [1], // Default placeholder category ID
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

  const config: any = {
    imageConfig: {
      aspectRatio: aspectRatio
    }
  };

  if (model === MODEL_IMAGE_PRO) {
      config.imageConfig.imageSize = resolution;
  }

  // Rate limiting for images is often stricter, using slightly larger delay
  const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
    model: model,
    contents: {
      parts: [{ text: enhancedPrompt }]
    },
    config: config
  }), 3, 3000);

  if (response.candidates?.[0]?.content?.parts) {
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData && part.inlineData.data) {
        return part.inlineData.data;
      }
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
      if (part.inlineData && part.inlineData.data) {
        return part.inlineData.data;
      }
    }
  }

  throw new Error("Image edit failed");
};

export const findRealYoutubeVideo = async (query: string): Promise<VideoData> => {
  const ai = getClient();
  
  const prompt = `
    Find the most relevant YouTube video for the search query: "${query}".
    
    Return a JSON object with:
    1. title: The exact title of the video.
    2. channel: The channel name.
    3. url: The watch URL (must be valid youtube.com/watch?v=...).
    4. caption: A professional journalistic caption (in the language of the query) explaining the video's relevance.
    5. altText: A descriptive alt text for screen readers describing the video context.
  `;

  const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
    model: MODEL_FLASH,
    contents: prompt,
    config: {
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
  }));

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