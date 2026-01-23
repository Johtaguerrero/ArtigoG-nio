import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getArticles, deleteArticle, getAuthors } from '../services/storageService';
import { ArticleData } from '../types';
import { FileText, Trash2, Edit2, Calendar, User } from 'lucide-react';

export const Library: React.FC = () => {
  const [articles, setArticles] = useState<ArticleData[]>([]);
  const [authorsMap, setAuthorsMap] = useState<Record<string, string>>({});

  useEffect(() => {
    loadData();
  }, []);

  const loadData = () => {
    setArticles(getArticles());
    
    // Build author map
    const authors = getAuthors();
    const map = authors.reduce((acc, author) => {
      acc[author.id] = author.name;
      return acc;
    }, {} as Record<string, string>);
    setAuthorsMap(map);
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (window.confirm("Tem certeza que deseja excluir este artigo permanentemente?")) {
      deleteArticle(id);
      loadData();
    }
  };

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString('pt-BR', {
        day: '2-digit', month: 'short', year: 'numeric'
      });
    } catch {
      return '';
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-3xl font-bold text-slate-800">Biblioteca</h2>
          <p className="text-slate-500">Todos os seus artigos gerados e rascunhos.</p>
        </div>
      </div>

      {articles.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-xl border border-dashed border-slate-300">
          <FileText size={48} className="mx-auto text-slate-300 mb-4" />
          <h3 className="text-lg font-medium text-slate-700">Sua biblioteca está vazia</h3>
          <p className="text-slate-500 mb-6">Crie seu primeiro artigo com IA para começar.</p>
          <Link to="/new" className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition">
            Criar Artigo
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {articles.map((article) => (
            <div key={article.id} className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition flex flex-col h-full group">
              <div className="h-40 bg-slate-100 rounded-t-xl overflow-hidden relative">
                 {article.imageSpecs?.[0]?.url && article.imageSpecs[0].url.startsWith('data:') ? (
                    <img src={article.imageSpecs[0].url} alt="" className="w-full h-full object-cover" />
                 ) : (
                    <div className="flex items-center justify-center h-full text-slate-300">
                      <FileText size={32} />
                    </div>
                 )}
                 <div className="absolute top-3 right-3">
                   <span className={`px-2 py-1 text-xs font-bold rounded-lg ${
                      article.status === 'completed' 
                        ? 'bg-green-100 text-green-700' 
                        : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {article.status === 'completed' ? 'Completo' : 'Rascunho'}
                    </span>
                 </div>
              </div>
              
              <div className="p-5 flex-1 flex flex-col">
                <h3 className="font-bold text-slate-800 text-lg mb-2 line-clamp-2" title={article.title || article.topic}>
                  {article.title || article.topic || 'Sem título'}
                </h3>
                
                <div className="flex items-center gap-4 text-xs text-slate-500 mb-4 mt-auto">
                   <div className="flex items-center gap-1">
                      <Calendar size={14} /> {formatDate(article.createdAt)}
                   </div>
                   <div className="flex items-center gap-1">
                      <User size={14} /> {authorsMap[article.authorId || ''] || 'N/A'}
                   </div>
                </div>

                <div className="flex justify-between items-center pt-4 border-t border-slate-100">
                   <div className="text-xs font-mono text-slate-400">
                     {article.wordCount} words
                   </div>
                   <div className="flex gap-2">
                      <Link to={`/edit/${article.id}`} className="p-2 text-blue-600 hover:bg-blue-50 rounded transition" title="Editar">
                         <Edit2 size={16} />
                      </Link>
                      <button 
                        onClick={(e) => handleDelete(e, article.id)} 
                        className="p-2 text-red-600 hover:bg-red-50 rounded transition" 
                        title="Excluir"
                      >
                         <Trash2 size={16} />
                      </button>
                   </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};