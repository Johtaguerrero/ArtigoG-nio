import React, { useEffect, useState } from 'react';
import { PlusCircle, TrendingUp, CheckCircle, Clock, FileText, Eye, Edit2, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getArticles, calculateStats, getAuthors, deleteArticle } from '../services/storageService';
import { ArticleData } from '../types';

const StatCard = ({ title, value, icon: Icon, color }: any) => (
  <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
    <div>
      <p className="text-sm font-medium text-slate-500 mb-1">{title}</p>
      <h3 className="text-2xl font-bold text-slate-800">{value}</h3>
    </div>
    <div className={`p-3 rounded-lg ${color}`}>
      <Icon size={24} className="text-white" />
    </div>
  </div>
);

export const Dashboard: React.FC = () => {
  const [articles, setArticles] = useState<ArticleData[]>([]);
  const [stats, setStats] = useState({ total: 0, avgSeo: 0, hoursSaved: 0 });
  const [authorsMap, setAuthorsMap] = useState<Record<string, string>>({});

  const loadData = () => {
    const data = getArticles();
    setArticles(data);
    setStats(calculateStats());
  };

  useEffect(() => {
    loadData();

    // Build author map
    const authors = getAuthors();
    const map = authors.reduce((acc, author) => {
      acc[author.id] = author.name;
      return acc;
    }, {} as Record<string, string>);
    setAuthorsMap(map);

  }, []);

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (window.confirm("Tem certeza que deseja excluir este artigo permanentemente? A ação não pode ser desfeita.")) {
      deleteArticle(id);
      loadData();
    }
  };

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
      }).format(date);
    } catch {
      return '';
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold text-slate-800">Bem vindo, Editor</h2>
          <p className="text-slate-500 text-sm md:text-base">Sua redação impulsionada por IA está pronta.</p>
        </div>
        <Link 
          to="/new" 
          className="w-full md:w-auto bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg flex items-center justify-center gap-2 shadow-lg shadow-blue-500/30 transition"
        >
          <PlusCircle size={20} />
          Criar Artigo
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        <StatCard title="Artigos Gerados" value={stats.total} icon={CheckCircle} color="bg-green-500" />
        <StatCard title="Score SEO Médio" value={`${stats.avgSeo}/100`} icon={TrendingUp} color="bg-blue-500" />
        <StatCard title="Horas Economizadas" value={`${stats.hoursSaved}h`} icon={Clock} color="bg-purple-500" />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden min-h-[400px]">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center">
          <h3 className="font-bold text-slate-800">Artigos Recentes</h3>
          {articles.length > 0 && <button className="text-sm text-blue-600 font-medium hover:underline">Ver todos</button>}
        </div>
        
        {articles.length === 0 ? (
          <div className="p-12 text-center text-slate-400 flex flex-col items-center">
            <FileText size={48} className="mb-4 text-slate-300" />
            <p className="text-lg font-medium text-slate-600">Nenhum artigo encontrado.</p>
            <p className="mb-6">Comece criando seu primeiro artigo com IA.</p>
            <Link 
              to="/new" 
              className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition font-medium"
            >
              Criar Novo Artigo
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {articles.map((article) => (
              <div key={article.id} className="p-4 md:p-6 hover:bg-slate-50 transition flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4 w-full sm:w-auto">
                   <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center text-slate-500 font-bold shrink-0">
                      AG
                   </div>
                   <div className="min-w-0 flex-1">
                      <h4 className="font-medium text-slate-800 line-clamp-1">{article.title || article.topic || 'Sem título'}</h4>
                      <p className="text-sm text-slate-500 truncate">
                        {formatDate(article.createdAt)} • {authorsMap[article.authorId || ''] || 'N/A'}
                      </p>
                   </div>
                </div>
                <div className="flex items-center justify-between w-full sm:w-auto gap-4 sm:gap-6">
                   <div className="text-right">
                      <span className="block text-xs font-bold text-slate-500 uppercase">SEO</span>
                      <span className="text-green-600 font-bold">{article.seoScore || 95}</span>
                   </div>
                   <div className="flex items-center gap-2">
                     <span className={`px-2 py-1 text-[10px] md:text-xs font-medium rounded-full whitespace-nowrap ${
                       article.status === 'completed' 
                         ? 'bg-green-100 text-green-700' 
                         : 'bg-yellow-100 text-yellow-700'
                     }`}>
                       {article.status === 'completed' ? 'Publicado' : 'Rascunho'}
                     </span>
                     
                     <div className="h-6 w-px bg-slate-200 mx-1 md:mx-2"></div>
                     
                     <Link 
                       to={`/edit/${article.id}`} 
                       className="p-1.5 md:p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                       title="Visualizar e Editar"
                     >
                       <Eye size={18} />
                     </Link>
                     <Link 
                       to={`/edit/${article.id}`} 
                       className="p-1.5 md:p-2 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition"
                       title="Editar Configurações"
                     >
                       <Edit2 size={18} />
                     </Link>
                     <button 
                       onClick={(e) => handleDelete(e, article.id)}
                       className="p-1.5 md:p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                       title="Excluir Artigo"
                     >
                       <Trash2 size={18} />
                     </button>
                   </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};