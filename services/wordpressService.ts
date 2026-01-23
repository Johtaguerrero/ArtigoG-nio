import { ArticleData, WordPressConfig } from "../types";

// Helper para converter Data URL (base64) em Blob binário para upload
const dataURItoBlob = (dataURI: string): Blob => {
  const byteString = atob(dataURI.split(',')[1]);
  const mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mimeString });
};

export const publishToWordPress = async (
    article: ArticleData,
    config: WordPressConfig
): Promise<{ id: number, link: string }> => {
    // 1. Validação Inicial
    if (!config.endpoint || !config.username || !config.applicationPassword) {
        throw new Error("Configuração do WordPress incompleta. Vá em Configurações > WordPress.");
    }

    // 2. Normalização da URL da API
    let baseUrl = config.endpoint.replace(/\/$/, ""); // Remove barra final
    if (!baseUrl.includes("wp-json")) {
        baseUrl = `${baseUrl}/wp-json`;
    }

    // 3. Autenticação (Basic Auth com Senha de Aplicativo)
    const authString = btoa(`${config.username}:${config.applicationPassword}`);
    const headers = {
        'Authorization': `Basic ${authString}`
    };

    try {
        // --- PASSO 4: Upload da Imagem Destacada (Hero) ---
        let featuredMediaId = 0;
        
        // Procura a imagem com role 'hero' que tenha dados em base64
        const heroImage = article.imageSpecs?.find(s => s.role === 'hero' && s.url && s.url.startsWith('data:'));

        if (heroImage) {
            try {
                const blob = dataURItoBlob(heroImage.url);
                const filename = heroImage.filename || `article-${article.id}-hero.jpg`;

                // Endpoint de Mídia do WP
                const mediaRes = await fetch(`${baseUrl}/wp/v2/media`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Basic ${authString}`,
                        'Content-Disposition': `attachment; filename="${filename}"`,
                        'Content-Type': blob.type
                    },
                    body: blob
                });

                if (mediaRes.ok) {
                    const mediaData = await mediaRes.json();
                    featuredMediaId = mediaData.id;
                    
                    // Opcional: Atualizar Alt Text e Descrição da imagem no WP
                    if (heroImage.alt) {
                        await fetch(`${baseUrl}/wp/v2/media/${featuredMediaId}`, {
                            method: 'POST', // Update
                            headers: { ...headers, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ 
                                alt_text: heroImage.alt,
                                title: heroImage.title || article.title,
                                description: heroImage.caption
                            })
                        });
                    }
                } else {
                    console.warn("Falha no upload da imagem:", await mediaRes.text());
                }
            } catch (imgError) {
                console.warn("Erro ao processar imagem para WP:", imgError);
                // Não bloqueamos o post se a imagem falhar
            }
        }

        // --- PASSO 5: Criação do Post ---
        const postData = {
            title: article.title || article.topic,
            content: article.htmlContent, // O HTML gerado pela IA
            status: 'draft', // Sempre como rascunho por segurança
            slug: article.seoData?.slug || article.targetKeyword.replace(/ /g, '-').toLowerCase(),
            excerpt: article.metaDescription, // Meta descrição vai para o resumo
            featured_media: featuredMediaId > 0 ? featuredMediaId : undefined, // Vincula a imagem enviada
            comment_status: 'open',
            ping_status: 'open'
            // Futuro: Adicionar tags/categorias aqui se necessário
        };

        const response = await fetch(`${baseUrl}/wp/v2/posts`, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(postData)
        });

        if (!response.ok) {
            const errorData = await response.json();
            // Tratamento de erro comum: CORS ou Permissão
            if (response.status === 401 || response.status === 403) {
                throw new Error("Erro de Permissão: Verifique seu usuário e Senha de Aplicativo.");
            }
            throw new Error(errorData.message || `Erro HTTP: ${response.status}`);
        }

        const data = await response.json();
        return {
            id: data.id,
            link: data.link // Link para preview ou post publicado
        };

    } catch (error: any) {
        console.error("WordPress publish failed:", error);
        // Melhorar mensagem de erro para o usuário
        if (error.message.includes("Failed to fetch")) {
            throw new Error("Erro de Conexão: Verifique se a URL do site está correta e se o site permite conexões externas (CORS).");
        }
        throw new Error(`${error.message}`);
    }
};