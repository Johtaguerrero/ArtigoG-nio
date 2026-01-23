import React, { useState, useEffect, useRef } from 'react';
import { Plus, Edit2, Trash2, X, User, Check, Upload, Image as ImageIcon } from 'lucide-react';
import { Author } from '../types';
import { getAuthors, saveAuthor, deleteAuthor, getArticles } from '../services/storageService';

export const AuthorsManager: React.FC = () => {
  const [authors, setAuthors] = useState<Author[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAuthor, setEditingAuthor] = useState<Author | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState<Partial<Author>>({
    name: '',
    bio: '',
    photoUrl: '',
    expertise: []
  });

  const [expertiseInput, setExpertiseInput] = useState('');

  useEffect(() => {
    loadAuthors();
  }, []);

  const loadAuthors = () => {
    setAuthors(getAuthors());
  };

  const handleOpenModal = (author?: Author) => {
    if (author) {
      setEditingAuthor(author);
      setFormData(author);
      setExpertiseInput(author.expertise.join(', '));
    } else {
      setEditingAuthor(null);
      setFormData({ name: '', bio: '', photoUrl: '', expertise: [] });
      setExpertiseInput('');
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingAuthor(null);
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); 
    
    // Check if author is used in any article
    const articles = getArticles();
    const usageCount = articles.filter(a => a.authorId === id).length;
    
    let confirmMessage = 'Tem certeza que deseja excluir este autor?';
    if (usageCount > 0) {
        confirmMessage = `Este autor está vinculado a ${usageCount} artigo(s). A exclusão removerá a autoria desses artigos (ficarão como 'Autor Desconhecido'). Continuar?`;
    }

    if (window.confirm(confirmMessage)) {
      deleteAuthor(id);
      loadAuthors();
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.size > 500 * 1024) {
        alert("Imagem muito grande (máx 500KB).");
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData(prev => ({ ...prev, photoUrl: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name || !formData.bio) {
      alert('Nome e Biografia são obrigatórios.');
      return;
    }

    const expertiseList = expertiseInput
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    const newAuthor: Author = {
      id: editingAuthor ? editingAuthor.id : crypto.randomUUID(),
      name: formData.name!,
      bio: formData.bio!,
      photoUrl: formData.photoUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(formData.name!)}&background=random`,
      expertise: expertiseList
    };

    try {
      saveAuthor(newAuthor);
      loadAuthors();
      handleCloseModal();
    } catch (error: any) {
      if (error.name === 'QuotaExceededError') {
        alert("Armazenamento cheio. Use uma foto menor.");
      } else {
        alert("Erro ao salvar.");
      }
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-3xl font-bold text-slate-800">Gerenciar Autores</h2>
          <p className="text-slate-500">Cadastre especialistas para E-E-A-T.</p>
        </div>
        <button 
          onClick={() => handleOpenModal()}
          className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg flex items-center gap-2 shadow-lg shadow-blue-500/30 transition"
        >
          <Plus size={20} />
          Adicionar
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {authors.map(author => (
          <div key={author.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col hover:shadow-md transition">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <img 
                  src={author.photoUrl} 
                  alt={author.name} 
                  className="w-12 h-12 rounded-full object-cover border border-slate-100 shadow-sm bg-slate-50"
                  onError={(e) => { (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(author.name)}` }}
                />
                <div>
                  <h3 className="font-bold text-slate-800 text-base leading-tight">{author.name}</h3>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {author.expertise.slice(0, 3).map((exp, i) => (
                      <span key={i} className="text-[10px] uppercase font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">
                        {exp}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            
            <p className="text-slate-600 text-xs mb-4 flex-grow line-clamp-3">
              {author.bio}
            </p>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button 
                onClick={() => handleOpenModal(author)}
                className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md transition"
                title="Editar"
              >
                <Edit2 size={16} />
              </button>
              <button 
                onClick={(e) => handleDelete(e, author.id)}
                className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md transition"
                title="Excluir"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}

        {authors.length === 0 && (
          <div className="col-span-full py-12 text-center text-slate-400 bg-slate-50 rounded-xl border-dashed border-2 border-slate-200">
            <User size={48} className="mx-auto mb-4 text-slate-300" />
            <p>Nenhum autor cadastrado.</p>
          </div>
        )}
      </div>

      {/* Compact Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-sm overflow-hidden animate-fade-in flex flex-col max-h-[90vh]">
            <div className="px-5 py-3 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-base font-bold text-slate-800">
                {editingAuthor ? 'Editar Autor' : 'Novo Autor'}
              </h3>
              <button onClick={handleCloseModal} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-5 space-y-3 overflow-y-auto">
              {/* Compact Image Upload */}
              <div className="flex flex-col items-center mb-2">
                <div 
                  className="relative group cursor-pointer w-20 h-20" 
                  onClick={() => fileInputRef.current?.click()}
                  title="Alterar foto"
                >
                  <div className="w-full h-full rounded-full overflow-hidden border-2 border-slate-200 shadow-inner bg-slate-50 relative">
                    {formData.photoUrl ? (
                      <img src={formData.photoUrl} alt="Preview" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-300">
                        <ImageIcon size={24} />
                      </div>
                    )}
                  </div>
                  <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <Upload className="text-white" size={20} />
                  </div>
                  <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileUpload} />
                </div>
                <span className="text-[10px] text-slate-400 mt-1">Máx 500KB</span>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Nome</label>
                <input 
                  type="text" 
                  required
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                  value={formData.name}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                  placeholder="Nome do autor"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Biografia (E-E-A-T)</label>
                <textarea 
                  required
                  rows={2}
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 outline-none resize-none"
                  value={formData.bio}
                  onChange={e => setFormData({...formData, bio: e.target.value})}
                  placeholder="Experiência e credenciais..."
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Expertise (separar por vírgula)</label>
                <input 
                  type="text" 
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                  value={expertiseInput}
                  onChange={e => setExpertiseInput(e.target.value)}
                  placeholder="Ex: Tech, Saúde"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">URL Foto (Opcional)</label>
                <input 
                  type="url" 
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                  value={formData.photoUrl}
                  onChange={e => setFormData({...formData, photoUrl: e.target.value})}
                  placeholder="https://..."
                />
              </div>

              <div className="pt-3 flex justify-end gap-2">
                <button 
                  type="button"
                  onClick={handleCloseModal}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded font-medium"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  className="px-4 py-1.5 text-xs bg-blue-600 text-white rounded font-medium hover:bg-blue-700 flex items-center gap-1"
                >
                  <Check size={14} /> Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};