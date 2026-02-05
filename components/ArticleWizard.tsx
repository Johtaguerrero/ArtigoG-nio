import React, { useState, useEffect } from 'react';
import { 
  Wand2, Save, FileText, BarChart2, User, Globe, 
  CheckCircle, AlertCircle, RefreshCw, Copy, Download, Eye, Plus, Image as ImageIcon, Video, MonitorPlay, Search, Loader2, Trash2, Upload, Languages, Settings2, Edit, Lightbulb, TrendingUp, Target, List, Code2, Database, ChevronDown, FileImage, Type, Maximize2, Sparkles, Youtube, Zap
} from 'lucide-react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { ArticleData, Author, GenerationProgress, ImageModelType, ImageResolution, AspectRatio } from '../types';
import * as geminiService from '../services/geminiService';
import * as wordpressService from '../services/wordpressService';
import { saveArticle, getAuthors, getArticle, deleteArticle, getSettings, saveSettings } from '../services/storageService';

// Helper seguro para geração de ID que funciona em todos os ambientes
const generateId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
};

// Helper de Throttling para evitar 429
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper para limpar mensagens de erro da API
const parseErrorMessage = (error: any): string => {
  let msg = error.message || "Erro desconhecido";
  
  // Tenta extrair mensagem JSON se estiver embutida
  try {
      const jsonMatch = msg.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
          const errorObj = JSON.parse(jsonMatch[0]);
          if (errorObj.error && errorObj.error.message) {
              msg = errorObj.error.message;
          }
      }
  } catch (e) {
      // Falha silenciosa no parse, usa a mensagem original
  }

  // Traduções amigáveis
  if (msg.includes("429") || msg.includes("quota") || msg.includes("RESOURCE_EXHAUSTED")) {
      return "Limite de cota excedido (Erro 429). Aguarde alguns instantes ou verifique sua API Key.";
  }
  if (msg.includes("API key not valid")) {
      return "Chave de API inválida. Verifique suas configurações.";
  }
  
  return msg;
};

const StepIndicator = ({ step, current }: { step: number, current: number }) => {
  const isCompleted = step < current;
  const isCurrent = step === current;
  
  return (
    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all text-sm md:text-base border-4 z-10 ${
        isCompleted ? 'bg-green-500 border-green-500 text-white' : 
        isCurrent ? 'bg-blue-600 border-blue-200 text-white shadow-lg' : 'bg-white border-slate-200 text-slate-400'
      }`}>
        {isCompleted ? <CheckCircle size={20} /> : step}
    </div>
  );
};

export const ArticleWizard: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<GenerationProgress>({ step: '', percentage: 0 });
  const [error, setError] = useState<string | null>(null);
  const [authors, setAuthors] = useState<Author[]>([]);
  
  // New state for publishing
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishSuccess, setPublishSuccess] = useState<string | null>(null);

  // Media State
  const [generatingImageIndex, setGeneratingImageIndex] = useState<number | null>(null);
  const [isSearchingVideo, setIsSearchingVideo] = useState(false);
  
  // Image Edit State
  const [editingImageIndex, setEditingImageIndex] = useState<number | null>(null);
  const [editPrompt, setEditPrompt] = useState("");
  const [isEditingImage, setIsEditingImage] = useState(false);

  // Article State initialized with safe ID generator
  const [article, setArticle] = useState<ArticleData>({
    id: generateId(),
    topic: '',
    targetKeyword: '',
    language: 'Português', // Default language
    wordCount: '1500',
    siteUrl: '',
    authorId: '',
    advancedOptions: {
      includeToc: true,
      includeGlossary: false,
      includeTables: true,
      includeLists: true,
      secureSources: true,
      authorCredits: true,
    },
    imageSettings: {
        model: 'gemini-2.5-flash-image',
        resolution: '1K'
    },
    status: 'draft',
    createdAt: new Date().toISOString()
  });

  const [activeTab, setActiveTab] = useState<'preview' | 'html' | 'seo' | 'eeat' | 'media'>('preview');
  const [eeatSubTab, setEeatSubTab] = useState<'score' | 'schema' | 'wp'>('score'); // New Sub-tab state for EEAT

  useEffect(() => {
    // Load authors safely
    try {
        const loadedAuthors = getAuthors();
        setAuthors(loadedAuthors || []);
        
        // Get global settings for defaults
        const settings = getSettings();

        // If ID is present in URL, load the article
        if (id) {
        const existingArticle = getArticle(id);
        if (existingArticle) {
            // Ensure language exists for older articles
            if (!existingArticle.language) existingArticle.language = 'Português';
            // Ensure defaults for image settings
            if (!existingArticle.imageSettings) {
                existingArticle.imageSettings = { model: 'gemini-2.5-flash-image', resolution: '1K' };
            }
            setArticle(existingArticle);
            // If it's already generated/completed, jump to step 3
            if (existingArticle.status === 'completed' || existingArticle.status === 'published' || existingArticle.htmlContent) {
            setCurrentStep(3);
            }
        }
        } else {
        // Setup NEW article defaults
        setArticle(prev => ({ 
            ...prev, 
            authorId: (loadedAuthors && loadedAuthors.length > 0) ? loadedAuthors[0].id : '',
            siteUrl: settings.defaultSiteUrl || '' // Pre-fill site URL from settings
        }));
        }
    } catch (e) {
        console.error("Error initializing wizard", e);
    }
  }, [id]);

  const handleSiteUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newUrl = e.target.value;
    setArticle(prev => ({ ...prev, siteUrl: newUrl }));
    
    // Save as default globally immediately
    const settings = getSettings();
    settings.defaultSiteUrl = newUrl;
    saveSettings(settings);
  };

  const handleGenerate = async () => {
    if (!article.topic || !article.targetKeyword) {
      setError("Por favor, preencha o tópico e a palavra-chave.");
      return;
    }

    setIsGenerating(true);
    setError(null);
    setCurrentStep(2); // Move to processing UI

    try {
      const currentAuthor = authors.find(a => a.id === article.authorId);

      // 1. SERP Analysis
      setProgress({ step: `Analisando SERP (${article.language})...`, percentage: 10 });
      const serpData = await geminiService.analyzeSerp(article.targetKeyword, article.language);
      
      await delay(2000); // Throttling

      // 2. Structure Generation
      setProgress({ step: 'Criando estrutura otimizada (E-E-A-T)...', percentage: 25 });
      const structure = await geminiService.generateArticleStructure(article.topic, article.targetKeyword, serpData, article.language);
      
      await delay(3000); // Throttling mais agressivo

      // 3. Main Content Generation
      setProgress({ step: 'Escrevendo conteúdo e criando Links Internos...', percentage: 50 });
      const htmlBody = await geminiService.generateMainContent(
        article.topic, 
        article.targetKeyword, 
        structure, 
        serpData, 
        article.wordCount, 
        article.advancedOptions,
        article.language,
        article.siteUrl,
        currentAuthor?.name
      );

      await delay(3000); // Throttling

      // 4. Media Strategy (Video + Images)
      setProgress({ step: 'Planejando Mídia (Vídeo e Imagens SEO)...', percentage: 75 });
      const mediaData = await geminiService.generateMediaStrategy(structure.title, article.targetKeyword, article.language);

      await delay(2000); // Throttling

      // AUTO HERO GENERATION - DEFAULT TO FLASH FOR SPEED
      if (mediaData.imageSpecs.length > 0) {
          const heroSpec = mediaData.imageSpecs[0];
          try {
             // Força uso do modelo configurado ou fallback para Flash
             const modelToUse = article.imageSettings?.model || 'gemini-2.5-flash-image';
             const resToUse = article.imageSettings?.resolution || '1K';
             
             setProgress({ step: 'Renderizando Hero Image...', percentage: 85 });
             const heroBase64 = await geminiService.generateImageFromPrompt(heroSpec.prompt, heroSpec.aspectRatio, modelToUse, resToUse);
             
             // Se retornar URL de placeholder (começa com http), use direto, senão converte base64
             if (heroBase64.startsWith('http')) {
                mediaData.imageSpecs[0].url = heroBase64;
             } else {
                mediaData.imageSpecs[0].url = `data:image/jpeg;base64,${heroBase64}`;
             }
             
             mediaData.imageSpecs[0].generatedWith = modelToUse;
             mediaData.imageSpecs[0].resolution = resToUse;
          } catch (e) {
             console.warn("Auto-hero generation failed", e);
             // Não falha o processo todo se a imagem falhar
          }
      }

      await delay(2000); // Throttling

      // 5. Metadata (Updated to return SeoData)
      setProgress({ step: 'Gerando metadados e schema JSON-LD...', percentage: 90 });
      const seoData = await geminiService.generateMetadata(article.topic, article.targetKeyword, htmlBody, article.language);

      // Combine HTML (Video Injection) using centralized helper
      let fullHtml = geminiService.injectVideoIntoHtml(htmlBody, mediaData.videoData);

      fullHtml = fullHtml.trim();

      // 6. Generate Technical SEO Data (Schema & WP JSON)
      const tempArticle: ArticleData = {
          ...article,
          title: structure.title,
          htmlContent: fullHtml,
          seoData: seoData,
          videoData: mediaData.videoData,
          imageSpecs: mediaData.imageSpecs,
      };
      const techSeo = geminiService.generateTechnicalSeo(tempArticle, currentAuthor);

      const completedArticle: ArticleData = {
        ...tempArticle,
        subtitle: structure.subtitle,
        metaDescription: seoData.metaDescription,
        metaKeywords: seoData.tags, 
        serpAnalysis: serpData,
        schemaJsonLd: techSeo.schemaJsonLd,
        wordpressPostJson: techSeo.wordpressPostJson,
        status: 'completed',
        seoScore: 95,
        eeatScore: 88,
        createdAt: article.createdAt || new Date().toISOString()
      };

      setArticle(completedArticle);
      saveArticle(completedArticle); // Persist to storage

      setProgress({ step: 'Concluído!', percentage: 100 });
      setTimeout(() => setCurrentStep(3), 1000);

    } catch (e: any) {
      console.error(e);
      const friendlyMsg = parseErrorMessage(e);
      setError(friendlyMsg);
      setCurrentStep(1); // Voltar para edição
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveDraft = () => {
    saveArticle({
        ...article,
        status: 'draft',
        createdAt: article.createdAt || new Date().toISOString()
    });
    alert("Rascunho salvo!");
  };

  const handleDeleteArticle = () => {
    if (window.confirm("Tem certeza que deseja excluir este artigo permanentemente?")) {
        deleteArticle(article.id);
        navigate('/');
    }
  };

  const handlePublishToWordPress = async () => {
    setIsPublishing(true);
    setError(null);
    setPublishSuccess(null);

    try {
        const settings = getSettings();
        const result = await wordpressService.publishToWordPress(article, settings.wordpress);
        
        setPublishSuccess(`Artigo publicado com sucesso! ID: ${result.id}`);
        setArticle({ ...article, status: 'published' });
        saveArticle({ ...article, status: 'published' });

    } catch (e: any) {
        console.error(e);
        setError("Erro ao publicar no WordPress: " + e.message);
    } finally {
        setIsPublishing(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert("Copiado!");
  };

  const SeoCopyField = ({ label, value, multiline = false, helper }: { label: string, value: string, multiline?: boolean, helper?: string }) => (
    <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 shadow-sm hover:shadow transition-shadow">
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1">{label}</span>
        <button 
          onClick={() => copyToClipboard(value)}
          className="text-blue-600 hover:text-blue-800 text-xs font-medium flex items-center gap-1"
        >
          <Copy size={12} /> Copiar
        </button>
      </div>
      {multiline ? (
        <div className="text-sm text-slate-800 font-mono bg-white p-3 rounded border border-slate-100 min-h-[60px] whitespace-pre-wrap word-break-all">{value}</div>
      ) : (
        <div className="text-sm text-slate-800 font-mono bg-white p-3 rounded border border-slate-100 truncate">{value}</div>
      )}
      {helper && <p className="text-[10px] text-slate-400 mt-1.5">{helper}</p>}
    </div>
  );

  const handleGenerateImage = async (index: number, prompt: string) => {
    setGeneratingImageIndex(index);
    try {
      const spec = article.imageSpecs![index];
      const model = article.imageSettings?.model || 'gemini-2.5-flash-image';
      const resolution = article.imageSettings?.resolution || '1K';

      const resultData = await geminiService.generateImageFromPrompt(prompt, spec.aspectRatio, model, resolution);
      
      // Checa se é URL ou Base64
      const dataUrl = resultData.startsWith('http') ? resultData : `data:image/jpeg;base64,${resultData}`;
      
      const newSpecs = [...(article.imageSpecs || [])];
      newSpecs[index] = { 
          ...newSpecs[index], 
          url: dataUrl,
          generatedWith: model,
          resolution: resolution
      };
      setArticle({ ...article, imageSpecs: newSpecs });
      saveArticle({ ...article, imageSpecs: newSpecs });
    } catch (e: any) {
      console.error(e);
      const friendlyMsg = parseErrorMessage(e);
      alert(`Erro ao gerar imagem: ${friendlyMsg}`);
    } finally {
      setGeneratingImageIndex(null);
    }
  };

  const handleOpenEditImage = (index: number) => {
    setEditingImageIndex(index);
    setEditPrompt("");
  };

  const handleEditImageSubmit = async () => {
    if (editingImageIndex === null || !editPrompt) return;
    
    setIsEditingImage(true);
    try {
      const spec = article.imageSpecs![editingImageIndex];
      // Use Nano Banana (Flash) for edits as requested
      const base64Data = await geminiService.editGeneratedImage(spec.url, editPrompt);
      const dataUrl = `data:image/jpeg;base64,${base64Data}`;

      const newSpecs = [...(article.imageSpecs || [])];
      newSpecs[editingImageIndex] = { ...newSpecs[editingImageIndex], url: dataUrl };
      setArticle({ ...article, imageSpecs: newSpecs });
      saveArticle({ ...article, imageSpecs: newSpecs });
      setEditingImageIndex(null); // Close modal
    } catch (e: any) {
      console.error(e);
      alert(`Falha ao editar imagem: ${parseErrorMessage(e)}`);
    } finally {
      setIsEditingImage(false);
    }
  };

  const handleDownloadImage = (url: string, filename: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSearchVideo = async () => {
    // CORREÇÃO CRÍTICA: Priorizar o input do usuário e remover lógica complexa de sobrescrita.
    // Se o usuário digitou algo, usamos aquilo. Ponto.
    let query = article.videoData?.query?.trim();
    
    // Apenas se estiver vazio, tentamos fallbacks inteligentes
    if (!query) {
         query = article.title || article.topic || article.targetKeyword;
    }
    
    if (!query) {
        alert("Digite um termo de busca ou gere o artigo primeiro.");
        return;
    }

    setIsSearchingVideo(true);
    try {
      // 1. Encontrar o vídeo usando o serviço (agora mais robusto)
      const videoResult = await geminiService.findRealYoutubeVideo(query);
      
      // 2. Usar o helper centralizado para injetar o vídeo
      const newHtmlContent = geminiService.injectVideoIntoHtml(article.htmlContent || '', videoResult);

      const updatedArticle = {
        ...article,
        videoData: videoResult,
        htmlContent: newHtmlContent
      };

      setArticle(updatedArticle);
      saveArticle(updatedArticle);
      
      // Feedback visual
      alert("Vídeo jornalístico e seguro encontrado e inserido com sucesso!");

    } catch (e: any) {
      console.error(e);
      let msg = parseErrorMessage(e);
      alert(msg);
    } finally {
      setIsSearchingVideo(false);
    }
  };

  // --- Render Steps ---

  const renderStep1 = () => (
    <div className="max-w-4xl mx-auto bg-white p-6 md:p-8 rounded-xl shadow-sm border border-slate-200 animate-fade-in">
        <div className="mb-8 flex flex-col md:flex-row justify-between items-start gap-4">
            <div>
            <h2 className="text-2xl font-bold text-slate-800">
                {id ? 'Editar Artigo' : 'Definição do Artigo'}
            </h2>
            <p className="text-slate-500">Configure os parâmetros para a IA gerar conteúdo de alta performance.</p>
            </div>
            <div className="flex items-center gap-3 w-full md:w-auto">
                {id && (
                    <button 
                    onClick={handleDeleteArticle}
                    className="bg-red-50 text-red-600 hover:bg-red-100 px-3 py-1 rounded text-sm font-medium flex items-center gap-1 transition-colors ml-auto md:ml-0"
                    >
                    <Trash2 size={14} /> Excluir
                    </button>
                )}
            {id && (
                <span className="bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded font-mono hidden md:inline">ID: {id.split('-')[0]}...</span>
            )}
            </div>
        </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Tópico Principal</label>
            <input 
              type="text" 
              className="w-full px-4 py-2 bg-white text-slate-900 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition placeholder:text-slate-400"
              placeholder="Ex: O futuro da Energia Solar no Brasil"
              value={article.topic}
              onChange={e => setArticle({...article, topic: e.target.value})}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Palavra-chave Foco (SEO)</label>
            <div className="relative">
              <input 
                type="text" 
                className="w-full px-4 py-2 bg-white text-slate-900 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition pr-10 placeholder:text-slate-400"
                placeholder="Ex: energia solar brasil 2025"
                value={article.targetKeyword}
                onChange={e => setArticle({...article, targetKeyword: e.target.value})}
              />
              <span className="absolute right-3 top-2.5 text-slate-400">
                <BarChart2 size={16} />
              </span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Idioma do Artigo</label>
            <div className="relative">
              <select 
                className="w-full px-4 py-2 bg-white text-slate-900 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition appearance-none"
                value={article.language}
                onChange={e => setArticle({...article, language: e.target.value})}
              >
                <option value="Português">Português (Brasil)</option>
                <option value="English">English (US)</option>
                <option value="Español">Español</option>
                <option value="Français">Français</option>
                <option value="Deutsch">Deutsch</option>
                <option value="Italiano">Italiano</option>
              </select>
              <span className="absolute right-3 top-2.5 text-slate-400 pointer-events-none">
                <Languages size={16} />
              </span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Site URL (para Links Internos)</label>
            <div className="relative">
              <input 
                type="url" 
                className="w-full px-4 py-2 bg-white text-slate-900 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition pr-10 placeholder:text-slate-400"
                placeholder="https://meusite.com.br"
                value={article.siteUrl}
                onChange={handleSiteUrlChange}
              />
              <span className="absolute right-3 top-2.5 text-slate-400">
                <Globe size={16} />
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-4">
           <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Contagem de Palavras</label>
            <div className="flex gap-2">
              {['800', '1500', '3000'].map((count) => (
                <button
                  key={count}
                  onClick={() => setArticle({...article, wordCount: count as any})}
                  className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition ${
                    article.wordCount === count 
                      ? 'bg-slate-900 border-slate-900 text-white' 
                      : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {count} pls
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Autor (E-E-A-T)</label>
            {authors.length > 0 ? (
              <select 
                className="w-full px-4 py-2 bg-white text-slate-900 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none placeholder:text-slate-400"
                value={article.authorId}
                onChange={e => setArticle({...article, authorId: e.target.value})}
              >
                {authors.map(author => (
                  <option key={author.id} value={author.id}>{author.name} ({author.expertise?.join(', ') || ''})</option>
                ))}
              </select>
            ) : (
              <div className="text-sm text-slate-500 bg-slate-50 p-3 rounded-lg border border-slate-200 flex justify-between items-center">
                <span>Nenhum autor cadastrado.</span>
                <Link to="/authors" className="text-blue-600 font-medium hover:underline flex items-center gap-1">
                  <Plus size={14} /> Criar
                </Link>
              </div>
            )}
          </div>

          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 block">Opções Avançadas</span>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center space-x-2 text-sm text-slate-700 cursor-pointer">
                <input type="checkbox" checked={article.advancedOptions.includeToc} onChange={e => setArticle({...article, advancedOptions: {...article.advancedOptions, includeToc: e.target.checked}})} className="rounded text-blue-600 focus:ring-blue-500" />
                <span>Sumário</span>
              </label>
              <label className="flex items-center space-x-2 text-sm text-slate-700 cursor-pointer">
                <input type="checkbox" checked={article.advancedOptions.includeTables} onChange={e => setArticle({...article, advancedOptions: {...article.advancedOptions, includeTables: e.target.checked}})} className="rounded text-blue-600 focus:ring-blue-500" />
                <span>Tabelas</span>
              </label>
              <label className="flex items-center space-x-2 text-sm text-slate-700 cursor-pointer">
                <input type="checkbox" checked={article.advancedOptions.includeGlossary} onChange={e => setArticle({...article, advancedOptions: {...article.advancedOptions, includeGlossary: e.target.checked}})} className="rounded text-blue-600 focus:ring-blue-500" />
                <span>Glossário</span>
              </label>
              <label className="flex items-center space-x-2 text-sm text-slate-700 cursor-pointer">
                <input type="checkbox" checked={article.advancedOptions.includeLists} onChange={e => setArticle({...article, advancedOptions: {...article.advancedOptions, includeLists: e.target.checked}})} className="rounded text-blue-600 focus:ring-blue-500" />
                <span>Listas</span>
              </label>
            </div>
          </div>
        </div>
      </div>
      
      {error && (
        <div className="mt-6 p-4 bg-red-50 text-red-700 rounded-lg border border-red-200 flex items-center gap-2 animate-fade-in">
          <AlertCircle size={20} className="shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      <div className="mt-8 flex justify-end">
        <button 
          onClick={handleGenerate}
          className="w-full md:w-auto bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-lg shadow-lg shadow-blue-500/30 flex items-center justify-center gap-2 transition-all hover:scale-[1.02]"
        >
          <Wand2 size={20} />
          {id ? 'Regerar Artigo' : 'Gerar Artigo com IA'}
        </button>
      </div>
    </div>
  );

  const renderProgress = () => (
    <div className="max-w-2xl mx-auto text-center py-20 animate-fade-in px-4">
      <div className="relative w-32 h-32 mx-auto mb-8">
        <div className="absolute inset-0 rounded-full border-4 border-slate-100"></div>
        <div className="absolute inset-0 rounded-full border-4 border-blue-500 border-t-transparent animate-spin"></div>
        <div className="absolute inset-0 flex items-center justify-center font-bold text-2xl text-blue-600">
          {progress.percentage}%
        </div>
      </div>
      <h3 className="text-xl font-bold text-slate-800 mb-2">{progress.step}</h3>
      <p className="text-slate-500 max-w-md mx-auto">
        A IA está pesquisando, analisando e escrevendo seu artigo. Isso pode levar alguns segundos.
      </p>
    </div>
  );

  const renderReview = () => {
    if (!article.htmlContent) return null;
    const currentAuthor = authors.find(a => a.id === article.authorId);

    // Helper: Determine if video is already visible in HTML content
    const isVideoEmbedded = article.htmlContent?.includes('featured-video-container') || 
                        (article.videoData?.embedHtml && article.htmlContent?.includes(article.videoData.embedHtml));
    const showFloatingVideo = article.videoData?.embedHtml && !isVideoEmbedded;

    return (
      <div className="max-w-6xl mx-auto animate-fade-in relative">
        {/* EDIT IMAGE MODAL */}
        {editingImageIndex !== null && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
                <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-fade-in">
                    <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                        <h3 className="font-bold text-slate-800 flex items-center gap-2">
                            <Wand2 size={18} className="text-purple-600"/> Editar Imagem com IA
                        </h3>
                        <button onClick={() => setEditingImageIndex(null)} className="text-slate-400 hover:text-slate-600"><Trash2 size={20} className="rotate-45" /></button>
                    </div>
                    <div className="p-6">
                        <div className="mb-4 rounded-lg overflow-hidden border border-slate-200">
                             <img src={article.imageSpecs![editingImageIndex].url} alt="To Edit" className="w-full h-48 object-cover" />
                        </div>
                        <div className="mb-4">
                            <label className="block text-sm font-medium text-slate-700 mb-2">Instrução de Edição</label>
                            <input 
                                type="text" 
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                                placeholder="Ex: Adicionar filtro vintage, remover fundo..."
                                value={editPrompt}
                                onChange={e => setEditPrompt(e.target.value)}
                            />
                            <p className="text-xs text-slate-500 mt-2">Usando modelo: Nano Banana (Flash Image) para edição rápida.</p>
                        </div>
                        <button 
                            onClick={handleEditImageSubmit}
                            disabled={isEditingImage || !editPrompt}
                            className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 rounded-lg flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            {isEditingImage ? <Loader2 size={18} className="animate-spin" /> : <Wand2 size={18} />}
                            Aplicar Edição
                        </button>
                    </div>
                </div>
            </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          {/* Header */}
          <div className="border-b border-slate-200 p-4 flex flex-col xl:flex-row justify-between items-center gap-4 bg-slate-50">
            <div className="w-full xl:w-auto overflow-x-auto pb-2 xl:pb-0">
                <div className="flex gap-2 bg-white p-1 rounded-lg border border-slate-200 min-w-max">
                {['preview', 'html', 'media', 'seo', 'eeat'].map((tab) => (
                    <button 
                    key={tab}
                    onClick={() => setActiveTab(tab as any)}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition flex items-center gap-2 whitespace-nowrap uppercase ${activeTab === tab ? 'bg-blue-100 text-blue-700' : 'text-slate-600 hover:bg-slate-50'}`}
                    >
                        {tab === 'preview' && <Eye size={16} />}
                        {tab === 'html' && <FileText size={16} />}
                        {tab === 'media' && <ImageIcon size={16} />}
                        {tab === 'seo' && <BarChart2 size={16} />}
                        {tab === 'eeat' && <User size={16} />}
                        {tab}
                    </button>
                ))}
                </div>
            </div>
            
            <div className="flex gap-3 w-full xl:w-auto flex-wrap justify-end">
               <button onClick={handleDeleteArticle} className="bg-red-50 text-red-600 hover:bg-red-100 px-3 py-2 rounded-lg"><Trash2 size={16} /></button>
               <button onClick={handleSaveDraft} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 shadow-sm flex-1 md:flex-none justify-center"><Save size={16} /> Salvar</button>
               <button onClick={handlePublishToWordPress} disabled={isPublishing} className="bg-slate-800 hover:bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 shadow-sm disabled:opacity-50 flex-1 md:flex-none justify-center">{isPublishing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} Publicar</button>
            </div>
          </div>
          
          {publishSuccess && <div className="bg-green-50 text-green-700 px-6 py-3 flex items-center gap-2 border-b border-green-100"><CheckCircle size={18} /> {publishSuccess}</div>}
          {error && <div className="bg-red-50 text-red-700 px-6 py-3 flex items-center gap-2 border-b border-red-100"><AlertCircle size={18} /> {error}</div>}

          {/* Content Area */}
          <div className="min-h-[600px] p-4 md:p-8">
            {activeTab === 'preview' && (
              <div className="max-w-3xl mx-auto">
                <h1 className="text-3xl md:text-4xl font-extrabold text-slate-900 mb-2 leading-tight">{article.title}</h1>
                <h2 className="text-lg md:text-xl text-slate-500 mb-8 font-light">{article.subtitle}</h2>
                <div className="w-full h-48 md:h-64 bg-slate-200 rounded-xl mb-8 flex items-center justify-center text-slate-400 overflow-hidden relative">
                   {article.imageSpecs?.[0]?.url && article.imageSpecs[0].url.startsWith('data:') ? (
                     <img src={article.imageSpecs[0].url} alt={article.imageSpecs[0].alt} className="w-full h-full object-cover" />
                   ) : (
                     <div className="text-center p-4"><p>Featured Image (Hero)</p></div>
                   )}
                </div>
                {article.advancedOptions.authorCredits && currentAuthor && (
                  <div className="flex items-center gap-3 mb-8 pb-8 border-b border-slate-100">
                    <img src={currentAuthor.photoUrl} className="w-10 h-10 rounded-full object-cover" alt="Author" onError={(e) => { (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(currentAuthor.name)}` }} />
                    <div><p className="text-sm font-bold text-slate-900">{currentAuthor.name}</p><p className="text-xs text-slate-500">Publicado em {new Date().toLocaleDateString()}</p></div>
                  </div>
                )}
                
                {/* Fallback Video Display: Shows ONLY if video exists but isn't detected in HTML */}
                {showFloatingVideo && (
                    <div className="my-8 mb-10 bg-slate-50 p-1 rounded-xl border border-slate-200">
                        <h3 className="text-lg font-bold mb-2 flex items-center gap-2 px-2 pt-2 text-slate-800">Assista: {article.videoData!.title}</h3>
                        <div className="aspect-video bg-black rounded-lg overflow-hidden shadow-sm" dangerouslySetInnerHTML={{ __html: article.videoData!.embedHtml }} />
                        {article.videoData!.caption && <p className="text-sm text-slate-500 mt-2 italic px-2 pb-1">{article.videoData!.caption}</p>}
                    </div>
                )}

                <div className="prose prose-slate max-w-none" dangerouslySetInnerHTML={{ __html: article.htmlContent }} />
              </div>
            )}

            {activeTab === 'html' && (
              <div className="relative">
                <div className="flex justify-between items-center mb-3">
                    <label className="text-sm font-bold text-slate-700 uppercase">HTML Puro (Copiar e colar no "Editor de Código" do WP)</label>
                    <button 
                        onClick={() => copyToClipboard(article.htmlContent!)} 
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition shadow-sm"
                    >
                        <Copy size={16} /> Copiar Código
                    </button>
                </div>
                <textarea 
                    className="w-full h-[600px] p-4 bg-slate-900 text-slate-50 font-mono text-xs md:text-sm rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none leading-relaxed"
                    value={article.htmlContent || ''}
                    readOnly
                    onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                />
                <p className="text-xs text-slate-500 mt-2">Dica: No WordPress, use o bloco "HTML Personalizado" ou mude o editor para "Editor de Código" e cole este conteúdo.</p>
              </div>
            )}

            {activeTab === 'media' && (
              <div className="max-w-6xl mx-auto">
                {/* Global Image Settings */}
                <div className="mb-8 bg-indigo-50 border border-indigo-100 rounded-xl p-6 flex flex-col md:flex-row items-center justify-between gap-4 shadow-sm">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-white text-indigo-700 rounded-xl shadow-sm border border-indigo-100"><Settings2 size={28}/></div>
                        <div>
                            <h4 className="font-bold text-lg text-indigo-900">Configuração de Geração de Imagem</h4>
                            <p className="text-sm text-indigo-600">Escolha entre velocidade (Flash) ou alta qualidade (Pro).</p>
                        </div>
                    </div>
                    <div className="flex gap-4">
                        <div>
                            <label className="text-[10px] font-bold text-indigo-400 uppercase block mb-1">Modelo</label>
                            <select 
                                className="bg-white border border-indigo-200 text-indigo-900 text-sm rounded-lg px-4 py-2.5 outline-none shadow-sm focus:ring-2 focus:ring-indigo-200"
                                value={article.imageSettings?.model}
                                onChange={(e) => {
                                    setArticle({
                                        ...article, 
                                        imageSettings: { ...article.imageSettings!, model: e.target.value as ImageModelType }
                                    });
                                }}
                            >
                                <option value="gemini-2.5-flash-image">Nano Banana (Flash) - Rápido</option>
                                <option value="gemini-3-pro-image-preview">Nano Banana Pro (Pro) - Alta Qualidade</option>
                            </select>
                        </div>
                        {article.imageSettings?.model === 'gemini-3-pro-image-preview' && (
                             <div>
                                <label className="text-[10px] font-bold text-indigo-400 uppercase block mb-1">Resolução</label>
                                <select 
                                    className="bg-white border border-indigo-200 text-indigo-900 text-sm rounded-lg px-4 py-2.5 outline-none shadow-sm focus:ring-2 focus:ring-indigo-200"
                                    value={article.imageSettings?.resolution}
                                    onChange={(e) => {
                                        setArticle({
                                            ...article, 
                                            imageSettings: { ...article.imageSettings!, resolution: e.target.value as ImageResolution }
                                        });
                                    }}
                                >
                                    <option value="1K">1K (Padrão)</option>
                                    <option value="2K">2K (Alto)</option>
                                    <option value="4K">4K (Ultra)</option>
                                </select>
                            </div>
                        )}
                    </div>
                </div>

                <section className="mb-12 bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
                   <h3 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2"><MonitorPlay className="text-red-600" /> Vídeo Recomendado</h3>
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Left Column: Search & Embed Code */}
                        <div className="space-y-6">
                            <div className="flex gap-2">
                                <input 
                                    type="text" 
                                    value={article.videoData?.query || ''} 
                                    onChange={(e) => {
                                        const currentVideoData = article.videoData || { 
                                            query: '', title: '', channel: '', url: '', embedHtml: '' 
                                        };
                                        setArticle({
                                            ...article, 
                                            videoData: {...currentVideoData, query: e.target.value}
                                        });
                                    }} 
                                    className="w-full bg-white border border-slate-300 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-red-500 outline-none"
                                    placeholder="Buscar vídeo no YouTube..."
                                />
                                <button 
                                    onClick={handleSearchVideo} 
                                    disabled={isSearchingVideo} 
                                    className="bg-red-600 text-white px-6 py-2 rounded-lg text-sm font-bold hover:bg-red-700 flex items-center gap-2 shadow-sm transition-transform active:scale-95 whitespace-nowrap"
                                >
                                    {isSearchingVideo ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />} 
                                    Buscar
                                </button>
                            </div>
                            
                            <div>
                                <div className="flex justify-between items-end mb-2">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase">Embed Code (WordPress)</label>
                                    <button onClick={() => copyToClipboard(article.videoData?.embedHtml || '')} className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 font-medium"><Copy size={12}/> Copiar</button>
                                </div>
                                <textarea 
                                    readOnly 
                                    value={article.videoData?.embedHtml || ''} 
                                    className="w-full bg-white border border-slate-300 rounded-lg px-4 py-3 text-xs font-mono text-slate-600 h-32 resize-none focus:ring-1 focus:ring-slate-300 outline-none" 
                                />
                            </div>

                             <div className="grid grid-cols-1 gap-4">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Legenda (Caption)</label>
                                    <input 
                                        type="text" 
                                        value={article.videoData?.caption || ''} 
                                        onChange={(e) => setArticle({...article, videoData: {...article.videoData!, caption: e.target.value}})}
                                        className="w-full bg-white border border-slate-300 rounded px-3 py-2 text-xs text-slate-700"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Alt Text (Acessibilidade)</label>
                                    <input 
                                        type="text" 
                                        value={article.videoData?.altText || ''} 
                                        onChange={(e) => setArticle({...article, videoData: {...article.videoData!, altText: e.target.value}})}
                                        className="w-full bg-white border border-slate-300 rounded px-3 py-2 text-xs text-slate-700"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Right Column: Preview */}
                        <div className="flex flex-col h-full">
                             <label className="text-[10px] font-bold text-slate-400 uppercase block mb-2">Preview</label>
                             {article.videoData?.embedHtml ? (
                                <div className="aspect-video bg-black rounded-xl overflow-hidden shadow-lg border border-slate-900 w-full" dangerouslySetInnerHTML={{ __html: article.videoData.embedHtml }} />
                             ) : (
                                <div className="aspect-video bg-black rounded-xl flex items-center justify-center text-slate-500 w-full shadow-inner border border-slate-800">
                                    <div className="text-center">
                                        <MonitorPlay size={48} className="mx-auto mb-2 opacity-50" />
                                        <p className="text-xs">Nenhum vídeo selecionado</p>
                                    </div>
                                </div>
                             )}
                             
                             {article.videoData?.title && (
                                 <div className="mt-4 p-3 bg-white rounded-lg border border-slate-200">
                                     <h4 className="font-bold text-slate-800 text-sm line-clamp-1">{article.videoData.title}</h4>
                                     <p className="text-xs text-slate-500">{article.videoData.channel}</p>
                                 </div>
                             )}
                        </div>
                   </div>
                </section>

                {/* Images Section - REFACTORED */}
                <section>
                  <h3 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2">
                    <ImageIcon className="text-blue-600" /> Pack de Imagens IA + SEO Completo
                  </h3>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {article.imageSpecs?.map((img, idx) => (
                      <div key={idx} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition group">
                         
                         {/* Header */}
                         <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                           <div className="flex items-center gap-3">
                             <span className="bg-blue-100 text-blue-700 px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wide">{img.role}</span>
                           </div>
                           <div className="flex items-center gap-2">
                               <select 
                                value={img.aspectRatio} 
                                onChange={(e) => {
                                    const newSpecs = [...(article.imageSpecs || [])];
                                    newSpecs[idx] = { ...newSpecs[idx], aspectRatio: e.target.value as any };
                                    setArticle({ ...article, imageSpecs: newSpecs });
                                }}
                                className="text-xs bg-white border border-slate-200 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-blue-500 font-mono text-slate-600 cursor-pointer hover:border-slate-300"
                             >
                                {['1:1', '3:4', '4:3', '9:16', '16:9', '21:9'].map(ratio => (
                                    <option key={ratio} value={ratio}>{ratio}</option>
                                ))}
                             </select>
                           </div>
                         </div>

                         {/* Image Preview Area */}
                         <div className="relative aspect-video bg-slate-100 border-b border-slate-100 flex items-center justify-center overflow-hidden">
                            {img.url && (img.url.startsWith('data:') || img.url.startsWith('http')) ? (
                                <>
                                    <img src={img.url} alt={img.alt} className="w-full h-full object-contain" />
                                    {/* Overlay Info */}
                                    <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-sm text-white text-[10px] px-2 py-1 rounded-md flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Sparkles size={10} className="text-yellow-400" />
                                        {img.generatedWith === 'gemini-3-pro-image-preview' ? 'Pro Model' : 'Flash Model'} • {img.resolution || '1K'}
                                    </div>
                                    {/* Action Buttons Overlay */}
                                    <div className="absolute bottom-3 right-3 flex gap-2">
                                         <button onClick={() => handleDownloadImage(img.url, img.filename)} className="p-2 bg-white/90 hover:bg-white text-slate-700 rounded-lg shadow-sm backdrop-blur-sm transition" title="Download">
                                            <Download size={16} />
                                         </button>
                                         <button onClick={() => handleOpenEditImage(idx)} className="p-2 bg-white/90 hover:bg-white text-purple-600 rounded-lg shadow-sm backdrop-blur-sm transition" title="Editar com IA">
                                            <Edit size={16} />
                                         </button>
                                    </div>
                                </>
                            ) : (
                                <div className="text-center p-6">
                                    <div className="w-16 h-16 bg-slate-200 rounded-full flex items-center justify-center mx-auto mb-3 text-slate-400">
                                        <ImageIcon size={32} />
                                    </div>
                                    <p className="text-sm text-slate-500 font-medium mb-4">Nenhuma imagem gerada</p>
                                    <button 
                                        onClick={() => handleGenerateImage(idx, img.prompt)}
                                        disabled={generatingImageIndex === idx}
                                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-sm inline-flex items-center gap-2"
                                    >
                                        {generatingImageIndex === idx ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
                                        Gerar Imagem
                                    </button>
                                </div>
                            )}
                         </div>

                         {/* Content Body */}
                         <div className="p-5 space-y-5">
                            {/* Prompt Section */}
                           <div>
                             <div className="flex justify-between items-center mb-1.5">
                                 <label className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1"><Sparkles size={10}/> Prompt IA</label>
                                 <button onClick={() => copyToClipboard(img.prompt)} className="text-[10px] text-blue-600 hover:underline">Copiar</button>
                             </div>
                             <textarea 
                                value={img.prompt} 
                                 onChange={(e) => {
                                    const newSpecs = [...(article.imageSpecs || [])];
                                    newSpecs[idx] = { ...newSpecs[idx], prompt: e.target.value };
                                    setArticle({ ...article, imageSpecs: newSpecs });
                                }}
                                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-600 h-20 resize-none focus:ring-1 focus:ring-blue-500 outline-none leading-relaxed" 
                             />
                           </div>

                           {/* Regenerate Button (if image exists) */}
                           {img.url && (img.url.startsWith('data:') || img.url.startsWith('http')) && (
                                <button 
                                    onClick={() => handleGenerateImage(idx, img.prompt)}
                                    disabled={generatingImageIndex === idx}
                                    className="w-full py-2 border border-blue-100 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg text-xs font-bold transition flex items-center justify-center gap-2"
                                >
                                    {generatingImageIndex === idx ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} 
                                    Regerar Imagem
                                </button>
                           )}

                           {/* Collapsible SEO Details */}
                           <details className="group/details">
                                <summary className="flex items-center justify-between cursor-pointer list-none py-2 px-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition border border-transparent hover:border-slate-200">
                                    <span className="text-xs font-bold text-slate-600 flex items-center gap-2">
                                        <Target size={14} className="text-slate-400"/> Detalhes SEO
                                    </span>
                                    <ChevronDown size={14} className="text-slate-400 group-open/details:rotate-180 transition-transform" />
                                </summary>
                                <div className="pt-4 space-y-4">
                                     <div>
                                        <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1 flex items-center gap-1"><FileImage size={10}/> Nome do Arquivo</label>
                                        <input 
                                            type="text" 
                                            value={img.filename} 
                                            onChange={(e) => {
                                                const newSpecs = [...(article.imageSpecs || [])];
                                                newSpecs[idx] = { ...newSpecs[idx], filename: e.target.value };
                                                setArticle({ ...article, imageSpecs: newSpecs });
                                            }}
                                            className="w-full bg-white border border-slate-200 rounded px-3 py-2 text-xs text-slate-700 font-mono focus:ring-1 focus:ring-blue-500 outline-none"
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Alt Text</label>
                                            <input 
                                                type="text"
                                                value={img.alt} 
                                                onChange={(e) => {
                                                    const newSpecs = [...(article.imageSpecs || [])];
                                                    newSpecs[idx] = { ...newSpecs[idx], alt: e.target.value };
                                                    setArticle({ ...article, imageSpecs: newSpecs });
                                                }}
                                                className="w-full bg-white border border-slate-200 rounded px-3 py-2 text-xs text-slate-700 focus:ring-1 focus:ring-blue-500 outline-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Título</label>
                                            <input 
                                                type="text"
                                                value={img.title} 
                                                onChange={(e) => {
                                                    const newSpecs = [...(article.imageSpecs || [])];
                                                    newSpecs[idx] = { ...newSpecs[idx], title: e.target.value };
                                                    setArticle({ ...article, imageSpecs: newSpecs });
                                                }}
                                                className="w-full bg-white border border-slate-200 rounded px-3 py-2 text-xs text-slate-700 focus:ring-1 focus:ring-blue-500 outline-none"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1 flex items-center gap-1"><Type size={10}/> Legenda</label>
                                        <input 
                                            type="text"
                                            value={img.caption} 
                                            onChange={(e) => {
                                                const newSpecs = [...(article.imageSpecs || [])];
                                                newSpecs[idx] = { ...newSpecs[idx], caption: e.target.value };
                                                setArticle({ ...article, imageSpecs: newSpecs });
                                            }}
                                            className="w-full bg-white border border-slate-200 rounded px-3 py-2 text-xs text-slate-700 focus:ring-1 focus:ring-blue-500 outline-none"
                                        />
                                    </div>
                                </div>
                           </details>
                         </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            )}

            {activeTab === 'seo' && (
              <div className="space-y-8 animate-fade-in">
                 <div className="flex items-center gap-3 border-b border-slate-200 pb-4">
                     <div className="p-2 bg-blue-100 text-blue-700 rounded-lg">
                         <BarChart2 size={24} />
                     </div>
                     <div>
                         <h2 className="text-xl font-bold text-slate-800">SEO Completo (Yoast / Google)</h2>
                         <p className="text-sm text-slate-500">Otimização máxima para Top Stories e Indexação.</p>
                     </div>
                 </div>
                 {/* ... Core SEO Grid ... */}
                 <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Left Column */}
                    <div className="space-y-6">
                        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                            <h3 className="text-sm font-bold text-slate-500 uppercase mb-4 flex items-center gap-2"><Target size={16}/> Core SEO</h3>
                            <div className="space-y-4">
                                <SeoCopyField label="Palavra-chave Principal" value={article.seoData?.targetKeyword || article.targetKeyword} />
                                <SeoCopyField label={`Título SEO (${article.seoData?.seoTitle?.length || 0}/60)`} value={article.seoData?.seoTitle || ''} helper="A palavra-chave deve estar no início."/>
                                <SeoCopyField label={`Meta Description (${article.seoData?.metaDescription?.length || 0}/156)`} value={article.seoData?.metaDescription || ''} multiline helper="Palavra-chave nos primeiros 100 caracteres."/>
                                <SeoCopyField label="Slug (URL Amigável)" value={article.seoData?.slug || ''} />
                            </div>
                        </div>

                         <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                            <h3 className="text-sm font-bold text-slate-500 uppercase mb-4 flex items-center gap-2"><List size={16}/> Semântica & Tags</h3>
                             <div className="space-y-4">
                                 <div>
                                     <span className="text-xs font-bold text-slate-500 block mb-2">4 Sinônimos (LSI)</span>
                                     <div className="flex flex-wrap gap-2">
                                         {article.seoData?.synonyms?.map((syn, i) => (
                                             <span key={i} className="px-3 py-1 bg-blue-50 text-blue-700 text-xs font-medium rounded-full border border-blue-100">{syn}</span>
                                         )) || <span className="text-slate-400 text-xs">Nenhum sinônimo gerado.</span>}
                                     </div>
                                 </div>
                                 <SeoCopyField label="Frase-chave Relacionada" value={article.seoData?.relatedKeyphrase || ''} />
                                 <div>
                                     <div className="flex justify-between items-center mb-2">
                                        <span className="text-xs font-bold text-slate-500">Tags (10 itens)</span>
                                        <button onClick={() => copyToClipboard(article.seoData?.tags?.join(', ') || '')} className="text-blue-600 text-xs font-medium flex gap-1"><Copy size={12}/> Copiar todas</button>
                                     </div>
                                     <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                                        <p className="text-sm text-slate-600 font-mono leading-relaxed">
                                        {article.seoData?.tags?.join(', ') || "Nenhuma tag gerada."}
                                        </p>
                                     </div>
                                 </div>
                                 {/* Novo Campo Resumo Viral WP */}
                                 <div className="mt-4 pt-4 border-t border-slate-100">
                                     <div className="flex justify-between items-center mb-2">
                                         <h4 className="text-xs font-bold text-purple-600 uppercase flex items-center gap-1"><Zap size={14}/> Resumo Viral (WordPress)</h4>
                                         <span className={`text-[10px] font-mono ${ (article.seoData?.wordpressExcerpt?.length || 0) > 180 ? 'text-red-500' : 'text-slate-400' }`}>
                                            {article.seoData?.wordpressExcerpt?.length || 0}/180
                                         </span>
                                     </div>
                                     <SeoCopyField 
                                         label="Resumo Otimizado (Excerpt)" 
                                         value={article.seoData?.wordpressExcerpt || ''} 
                                         multiline 
                                         helper="Resumo viral de alto CTR, ideal para o algoritmo de recomendação do Google."
                                     />
                                 </div>
                             </div>
                         </div>
                    </div>

                    {/* Right Column */}
                    <div className="space-y-6">
                         <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
                            <h3 className="text-sm font-bold text-slate-700 uppercase mb-4 flex items-center gap-2"><TrendingUp size={16}/> Análise SERP</h3>
                            <div className="mb-4">
                                <span className="text-xs font-bold text-slate-500 block mb-1">3 Concorrentes Analisados</span>
                                <ul className="list-disc pl-4 text-xs text-slate-600 space-y-1">
                                    {article.serpAnalysis?.competitorTitles.map((t, i) => <li key={i}>{t}</li>)}
                                </ul>
                            </div>
                             <div className="mb-4">
                                <span className="text-xs font-bold text-slate-500 block mb-1">Brechas Encontradas</span>
                                <ul className="list-disc pl-4 text-xs text-slate-600 space-y-1">
                                    {article.serpAnalysis?.contentGaps.map((t, i) => <li key={i}>{t}</li>)}
                                </ul>
                            </div>
                            <div className="bg-white p-3 rounded-lg border border-slate-200">
                                <span className="text-xs font-bold text-green-600 block mb-1 flex items-center gap-1"><CheckCircle size={12}/> Estratégia para Superar</span>
                                <p className="text-xs text-slate-700 leading-relaxed">{article.serpAnalysis?.strategy || "Foque em profundidade e E-E-A-T."}</p>
                            </div>
                         </div>

                         <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-5">
                            <h3 className="text-sm font-bold text-yellow-800 uppercase mb-4 flex items-center gap-2"><Lightbulb size={16}/> Oportunidades de Ouro</h3>
                            <div className="space-y-4">
                                <div>
                                    <span className="text-xs font-bold text-yellow-700 block mb-1">🏆 Featured Snippet</span>
                                    <p className="text-xs text-slate-700 bg-white p-2 rounded border border-yellow-100">{article.seoData?.opportunities?.featuredSnippet || "N/A"}</p>
                                </div>
                                <div>
                                    <span className="text-xs font-bold text-yellow-700 block mb-1">📰 Google News</span>
                                    <p className="text-xs text-slate-700 bg-white p-2 rounded border border-yellow-100">{article.seoData?.opportunities?.googleNews || "N/A"}</p>
                                </div>
                                <div>
                                    <span className="text-xs font-bold text-yellow-700 block mb-1">❓ People Also Ask</span>
                                    <ul className="text-xs text-slate-700 bg-white p-2 rounded border border-yellow-100 list-disc pl-5">
                                        {article.seoData?.opportunities?.paa?.slice(0, 3).map((q, i) => (
                                            <li key={i}>{q}</li>
                                        )) || <li>Nenhuma PAA identificada.</li>}
                                    </ul>
                                </div>
                            </div>
                         </div>
                    </div>
                 </div>
              </div>
            )}

            {/* E-E-A-T & Technical SEO Tab */}
            {activeTab === 'eeat' && (
              <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
                 
                 <div className="bg-white border border-yellow-200 rounded-xl p-6 shadow-sm flex justify-between items-center">
                    <div>
                        <h3 className="text-lg font-bold text-slate-800">Pontuação E-E-A-T: {article.eeatScore || 85}/100</h3>
                        <p className="text-sm text-slate-500">Avaliação baseada em Experiência, Especialidade, Autoridade e Confiança.</p>
                    </div>
                    <div className="p-3 bg-yellow-50 text-yellow-600 rounded-full border border-yellow-100">
                        <CheckCircle size={32} />
                    </div>
                 </div>

                 {/* Sub-tabs for Technical Content */}
                 <div className="flex gap-4 border-b border-slate-200 pb-1 overflow-x-auto">
                    <button 
                        onClick={() => setEeatSubTab('score')}
                        className={`pb-3 px-4 text-sm font-medium transition whitespace-nowrap ${eeatSubTab === 'score' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                        Análise de Qualidade
                    </button>
                    <button 
                        onClick={() => setEeatSubTab('schema')}
                        className={`pb-3 px-4 text-sm font-medium transition whitespace-nowrap ${eeatSubTab === 'schema' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                        <div className="flex items-center gap-2"><Code2 size={16}/> Schema JSON-LD</div>
                    </button>
                    <button 
                        onClick={() => setEeatSubTab('wp')}
                        className={`pb-3 px-4 text-sm font-medium transition whitespace-nowrap ${eeatSubTab === 'wp' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                        <div className="flex items-center gap-2"><Database size={16}/> WordPress JSON</div>
                    </button>
                 </div>

                 {eeatSubTab === 'score' && (
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-slate-50 p-6 rounded-xl border border-slate-200">
                             <h4 className="font-bold text-slate-700 mb-2">Checklist de Autoridade</h4>
                             <ul className="space-y-2 text-sm text-slate-600">
                                 <li className="flex items-center gap-2"><CheckCircle size={16} className="text-green-500"/> Autor Especialista identificado</li>
                                 <li className="flex items-center gap-2"><CheckCircle size={16} className="text-green-500"/> Links externos confiáveis (.gov/.edu)</li>
                                 <li className="flex items-center gap-2"><CheckCircle size={16} className="text-green-500"/> Conteúdo original e profundo</li>
                                 <li className="flex items-center gap-2"><CheckCircle size={16} className="text-green-500"/> Informações de contato/sobre claros</li>
                             </ul>
                        </div>
                        <div className="bg-slate-50 p-6 rounded-xl border border-slate-200">
                             <h4 className="font-bold text-slate-700 mb-2">Recomendações</h4>
                             <p className="text-sm text-slate-600 mb-2">Para atingir 100/100, adicione mais citações de estudos acadêmicos recentes e inclua uma política editorial visível no rodapé do artigo.</p>
                        </div>
                     </div>
                 )}

                 {eeatSubTab === 'schema' && (
                     <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                        <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                            <div>
                                <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2"><Code2 size={16} className="text-purple-600"/> Schema Markup Validado</h4>
                                <p className="text-xs text-slate-500">Inclui Article, NewsArticle, FAQPage, Organization e VideoObject.</p>
                            </div>
                            <button 
                                onClick={() => copyToClipboard(article.schemaJsonLd || '')}
                                className="text-xs bg-white border border-slate-300 px-3 py-1.5 rounded-lg font-medium hover:bg-slate-50 text-slate-700 flex items-center gap-1"
                            >
                                <Copy size={14}/> Copiar JSON
                            </button>
                        </div>
                        <div className="relative">
                            <pre className="p-4 text-xs font-mono text-slate-600 bg-slate-50/50 overflow-x-auto h-96 whitespace-pre-wrap">
                                {article.schemaJsonLd || '// Gerando Schema...'}
                            </pre>
                        </div>
                     </div>
                 )}

                 {eeatSubTab === 'wp' && (
                     <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                        <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                            <div>
                                <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2"><Database size={16} className="text-blue-600"/> WordPress REST Payload</h4>
                                <p className="text-xs text-slate-500">Estrutura pronta para automação via API ou n8n/Zapier.</p>
                            </div>
                            <button 
                                onClick={() => copyToClipboard(article.wordpressPostJson || '')}
                                className="text-xs bg-white border border-slate-300 px-3 py-1.5 rounded-lg font-medium hover:bg-slate-50 text-slate-700 flex items-center gap-1"
                            >
                                <Copy size={14}/> Copiar JSON
                            </button>
                        </div>
                        <div className="relative">
                            <pre className="p-4 text-xs font-mono text-slate-600 bg-slate-50/50 overflow-x-auto h-96 whitespace-pre-wrap">
                                {article.wordpressPostJson || '// Gerando Payload WP...'}
                            </pre>
                        </div>
                     </div>
                 )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (currentStep === 1) return renderStep1();
  if (currentStep === 2) return renderProgress();
  return renderReview();
};