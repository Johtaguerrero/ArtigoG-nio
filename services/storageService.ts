import { ArticleData, Author, AppSettings } from '../types';

const STORAGE_KEY = 'artigo_genio_articles';
const AUTHORS_KEY = 'artigo_genio_authors';
const SETTINGS_KEY = 'artigo_genio_settings';
const API_KEY_STORAGE = 'artigo_genio_api_key';
const CLIENT_ID_STORAGE = 'artigo_genio_client_id';

// PLACEHOLDER: Este valor é usado apenas se não houver um no LocalStorage
// Não exportamos mais como constante hardcoded para forçar o uso da função getGoogleClientId
const DEFAULT_CLIENT_ID = ""; 

export const parseJwt = (token: string) => {
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch (e) {
    return null;
  }
};

// --- Google Client ID Management ---

export const getGoogleClientId = (): string => {
  return localStorage.getItem(CLIENT_ID_STORAGE) || DEFAULT_CLIENT_ID;
};

export const saveGoogleClientId = (id: string): void => {
  if (!id) {
    localStorage.removeItem(CLIENT_ID_STORAGE);
  } else {
    localStorage.setItem(CLIENT_ID_STORAGE, id.trim());
  }
};

// --- API Key Management (Browser Side) ---

export const getBrowserApiKey = (): string => {
  return localStorage.getItem(API_KEY_STORAGE) || '';
};

export const saveBrowserApiKey = (key: string): void => {
  if (!key) {
    localStorage.removeItem(API_KEY_STORAGE);
  } else {
    localStorage.setItem(API_KEY_STORAGE, key.trim());
  }
};

// --- Articles ---

export const getArticles = (): ArticleData[] => {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error("Error reading articles from storage", error);
    return [];
  }
};

export const getArticle = (id: string): ArticleData | undefined => {
  const articles = getArticles();
  return articles.find(a => a.id === id);
};

// HELPER: Tenta salvar e gerencia erro de cota (QuotaExceededError)
const trySaveArticles = (articles: ArticleData[]): boolean => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(articles));
        return true;
    } catch (e: any) {
        // Detecta erro de cota do navegador (5MB limit)
        if (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014) {
            return false;
        }
        throw e; // Outros erros
    }
};

export const saveArticle = (article: ArticleData): void => {
  let articles = getArticles();
  const index = articles.findIndex(a => a.id === article.id);
  
  if (index >= 0) {
    articles[index] = { ...articles[index], ...article };
  } else {
    articles.unshift(article);
  }
  
  // TENTATIVA 1: Salvar normalmente
  if (trySaveArticles(articles)) return;

  console.warn("Storage Quota Exceeded. Starting cleanup strategy...");

  // TENTATIVA 2: Remover imagens (base64) de TODOS os artigos EXCETO o atual
  // Isso libera muito espaço sem perder o texto dos artigos antigos
  articles = articles.map(a => {
      if (a.id === article.id) return a; // Mantém o atual intacto
      
      // Limpa imagens dos antigos
      if (a.imageSpecs && a.imageSpecs.length > 0) {
          const hasBase64 = a.imageSpecs.some(img => img.url && img.url.startsWith('data:'));
          if (hasBase64) {
              return {
                  ...a,
                  imageSpecs: a.imageSpecs.map(spec => ({
                      ...spec,
                      url: spec.url.startsWith('data:') ? '' : spec.url // Remove apenas base64 pesado
                  }))
              };
          }
      }
      return a;
  });

  if (trySaveArticles(articles)) {
      console.log("Cleanup success: Removed images from older articles.");
      return;
  }

  // TENTATIVA 3: Remover artigos mais antigos (LIFO)
  // Mantém no máximo os 10 mais recentes se o espaço estiver crítico
  const originalLength = articles.length;
  while (articles.length > 5) { // Protege pelo menos 5
      articles.pop(); // Remove o último (mais antigo)
      if (trySaveArticles(articles)) {
          console.log(`Cleanup success: Deleted ${originalLength - articles.length} oldest articles.`);
          return;
      }
  }

  // TENTATIVA 4 (Emergência): Remover imagens do PRÓPRIO artigo atual para salvar o texto
  // É melhor salvar o texto sem imagem do que perder tudo
  const currentIdx = articles.findIndex(a => a.id === article.id);
  if (currentIdx >= 0 && articles[currentIdx].imageSpecs) {
      articles[currentIdx].imageSpecs = articles[currentIdx].imageSpecs?.map(spec => ({
          ...spec,
          url: '' 
      }));
      if (trySaveArticles(articles)) {
          alert("Aviso de Armazenamento: O limite do navegador foi atingido. As imagens deste artigo não foram salvas para preservar o texto. Faça o download das imagens antes de sair.");
          return;
      }
  }

  alert("Erro Crítico: Armazenamento do navegador cheio. Não foi possível salvar este artigo. Tente excluir itens manualmente da Biblioteca.");
};

export const deleteArticle = (id: string): void => {
  const articles = getArticles().filter(a => a.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(articles));
};

// --- Authors ---

export const getAuthors = (): Author[] => {
  try {
    const data = localStorage.getItem(AUTHORS_KEY);
    if (data) return JSON.parse(data);

    // Seed default authors if empty
    const defaultAuthors: Author[] = [
      { 
        id: '1', 
        name: 'Dra. Ana Silva', 
        bio: 'Especialista em Tecnologia e IA com 10 anos de experiência.', 
        photoUrl: 'https://i.pravatar.cc/150?u=a042581f4e29026024d', 
        expertise: ['Tech', 'AI'] 
      },
      { 
        id: '2', 
        name: 'Carlos Mendes', 
        bio: 'Jornalista sênior focado em Economia Digital.', 
        photoUrl: 'https://i.pravatar.cc/150?u=a042581f4e29026704d', 
        expertise: ['Finance', 'Crypto'] 
      },
    ];
    localStorage.setItem(AUTHORS_KEY, JSON.stringify(defaultAuthors));
    return defaultAuthors;
  } catch (error) {
    console.error("Error reading authors from storage", error);
    return [];
  }
};

export const saveAuthor = (author: Author): void => {
  const authors = getAuthors();
  const index = authors.findIndex(a => a.id === author.id);
  
  if (index >= 0) {
    authors[index] = { ...authors[index], ...author };
  } else {
    authors.push(author);
  }
  
  try {
    localStorage.setItem(AUTHORS_KEY, JSON.stringify(authors));
  } catch (e) {
    alert("Não foi possível salvar o autor (Limite de armazenamento). Tente usar uma foto menor.");
  }
};

export const deleteAuthor = (id: string): void => {
  const authors = getAuthors().filter(a => a.id !== id);
  localStorage.setItem(AUTHORS_KEY, JSON.stringify(authors));
};

// --- Settings (Admin, Keys, WP) ---

export const getSettings = (): AppSettings => {
  try {
    const data = localStorage.getItem(SETTINGS_KEY);
    if (data) {
        const parsed = JSON.parse(data);
        return {
            ...parsed,
            defaultSiteUrl: parsed.defaultSiteUrl || ''
        };
    }
    
    // Default settings
    return {
      adminProfile: {
        name: 'Administrador',
        role: 'Editor Chefe',
        photoUrl: ''
      },
      wordpress: {
        endpoint: '',
        username: '',
        applicationPassword: ''
      },
      defaultSiteUrl: ''
    };
  } catch (error) {
    console.error("Error reading settings", error);
    return {
      adminProfile: { name: 'Admin', role: 'Editor', photoUrl: '' },
      wordpress: { endpoint: '', username: '', applicationPassword: '' },
      defaultSiteUrl: ''
    };
  }
};

export const saveSettings = (settings: AppSettings): void => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
};

// --- Stats ---

export const calculateStats = () => {
  const articles = getArticles();
  const total = articles.length;
  const completed = articles.filter(a => a.status === 'completed' || a.status === 'published').length;
  
  // Calculate average SEO score
  const seoScores = articles
    .map(a => a.seoScore || (a.status === 'completed' ? 90 : 0))
    .filter(s => s > 0);
    
  const avgSeo = seoScores.length > 0 
    ? Math.round(seoScores.reduce((a, b) => a + b, 0) / seoScores.length) 
    : 0;

  // Estimate hours saved: 4 hours per article
  const hoursSaved = completed * 4;

  return { total, avgSeo, hoursSaved };
};