import React, { useState, useEffect, useRef } from 'react';
import { Save, User, Globe, Upload, Image as ImageIcon, Check, LogOut } from 'lucide-react';
import { AppSettings } from '../types';
import { getSettings, saveSettings } from '../services/storageService';

export const Settings: React.FC = () => {
    const [settings, setSettings] = useState<AppSettings>({
        adminProfile: { name: '', role: '', photoUrl: '' },
        wordpress: { endpoint: '', username: '', applicationPassword: '' }
    });
    
    const [activeTab, setActiveTab] = useState<'admin' | 'wp'>('admin');
    const [isSaved, setIsSaved] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setSettings(getSettings());
    }, []);

    const handleSave = () => {
        saveSettings(settings);
        setIsSaved(true);
        setTimeout(() => setIsSaved(false), 3000);
    };

    const handleLogout = () => {
        const updatedSettings: AppSettings = {
            ...settings,
            adminProfile: {
                name: 'Administrador',
                role: 'Editor',
                photoUrl: '',
                email: undefined,
                googleId: undefined
            }
        };
        saveSettings(updatedSettings);
        window.location.reload();
    };

    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (settings.adminProfile.googleId) return; // Prevent upload if google login

        const file = event.target.files?.[0];
        if (file) {
            if (file.size > 500 * 1024) {
                alert("A imagem é muito grande. Máx 500KB.");
                return;
            }
            const reader = new FileReader();
            reader.onloadend = () => {
                setSettings(prev => ({
                    ...prev,
                    adminProfile: { ...prev.adminProfile, photoUrl: reader.result as string }
                }));
            };
            reader.readAsDataURL(file);
        }
    };

    const isGoogleLogin = !!settings.adminProfile.googleId;

    return (
        <div className="p-4 md:p-8 max-w-4xl mx-auto">
             <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
                <div>
                    <h2 className="text-2xl md:text-3xl font-bold text-slate-800">Configurações</h2>
                    <p className="text-slate-500 text-sm md:text-base">Gerencie seu perfil e integrações.</p>
                </div>
                <button 
                    onClick={handleSave}
                    className="w-full md:w-auto bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-6 rounded-lg flex items-center justify-center gap-2 shadow-lg shadow-blue-500/30 transition"
                >
                    {isSaved ? <Check size={20} /> : <Save size={20} />}
                    {isSaved ? 'Salvo!' : 'Salvar Alterações'}
                </button>
            </div>

            <div className="flex gap-4 mb-8 border-b border-slate-200 overflow-x-auto pb-1">
                <button 
                    onClick={() => setActiveTab('admin')}
                    className={`pb-3 px-4 font-medium transition whitespace-nowrap ${activeTab === 'admin' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500 hover:text-slate-800'}`}
                >
                    <div className="flex items-center gap-2"><User size={18}/> Perfil Admin</div>
                </button>
                <button 
                    onClick={() => setActiveTab('wp')}
                    className={`pb-3 px-4 font-medium transition whitespace-nowrap ${activeTab === 'wp' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500 hover:text-slate-800'}`}
                >
                     <div className="flex items-center gap-2"><Globe size={18}/> WordPress</div>
                </button>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 md:p-8 animate-fade-in">
                {activeTab === 'admin' && (
                    <div className="space-y-6 max-w-lg">
                        {isGoogleLogin && (
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex gap-3 text-blue-800 mb-2">
                                <div className="w-8 h-8 flex items-center justify-center bg-white rounded-full shrink-0">
                                    <svg className="w-5 h-5" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                                </div>
                                <div className="text-sm">
                                    <p className="font-bold">Conta Google Conectada</p>
                                    <p>Suas informações de perfil (nome, foto) são gerenciadas pelo Google.</p>
                                </div>
                            </div>
                        )}

                        <div className="flex flex-col items-center mb-6">
                            <div className={`relative group w-32 h-32 ${!isGoogleLogin ? 'cursor-pointer' : ''}`} onClick={() => !isGoogleLogin && fileInputRef.current?.click()}>
                                <div className="w-full h-full rounded-full overflow-hidden border-4 border-slate-100 shadow-inner bg-slate-50 relative">
                                    {settings.adminProfile.photoUrl ? (
                                        <img src={settings.adminProfile.photoUrl} alt="Admin" className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-slate-300">
                                            <ImageIcon size={48} />
                                        </div>
                                    )}
                                </div>
                                {!isGoogleLogin && (
                                    <div className="absolute inset-0 bg-black/40 rounded-full flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Upload className="text-white mb-1" size={24} />
                                        <span className="text-[10px] text-white font-bold uppercase">Foto</span>
                                    </div>
                                )}
                                <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileUpload} disabled={isGoogleLogin} />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Nome de Exibição</label>
                            <input 
                                type="text" 
                                className={`w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none ${isGoogleLogin ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : ''}`}
                                value={settings.adminProfile.name}
                                onChange={e => setSettings({...settings, adminProfile: {...settings.adminProfile, name: e.target.value}})}
                                disabled={isGoogleLogin}
                            />
                        </div>
                        
                        {isGoogleLogin && (
                             <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Email (Google)</label>
                                <input 
                                    type="text" 
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg bg-slate-100 text-slate-500 cursor-not-allowed"
                                    value={settings.adminProfile.email || ''}
                                    readOnly
                                />
                            </div>
                        )}

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Cargo / Função</label>
                            <input 
                                type="text" 
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                value={settings.adminProfile.role}
                                onChange={e => setSettings({...settings, adminProfile: {...settings.adminProfile, role: e.target.value}})}
                            />
                        </div>

                        {isGoogleLogin && (
                            <div className="pt-4 border-t border-slate-100">
                                <button 
                                    onClick={handleLogout}
                                    className="text-red-600 hover:text-red-700 font-medium flex items-center gap-2 px-4 py-2 border border-red-200 hover:bg-red-50 rounded-lg transition text-sm w-full justify-center"
                                >
                                    <LogOut size={16} /> Desconectar Conta Google
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'wp' && (
                    <div className="space-y-6 max-w-lg">
                         <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                            <p className="text-sm text-blue-800">
                                Configure a conexão para postagem automática. Você precisa criar uma <strong>Senha de Aplicativo</strong> no WordPress (Usuários &gt; Perfil &gt; Senhas de Aplicativo).
                            </p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">URL do Site (Endpoint)</label>
                            <input 
                                type="url" 
                                placeholder="https://meusite.com.br"
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                value={settings.wordpress.endpoint}
                                onChange={e => setSettings({...settings, wordpress: {...settings.wordpress, endpoint: e.target.value}})}
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Nome de Usuário (Login)</label>
                            <input 
                                type="text" 
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                value={settings.wordpress.username}
                                onChange={e => setSettings({...settings, wordpress: {...settings.wordpress, username: e.target.value}})}
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Senha de Aplicativo</label>
                            <input 
                                type="password" 
                                placeholder="abcd 1234 efgh 5678"
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-mono"
                                value={settings.wordpress.applicationPassword}
                                onChange={e => setSettings({...settings, wordpress: {...settings.wordpress, applicationPassword: e.target.value}})}
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
