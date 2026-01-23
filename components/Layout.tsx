import React, { useEffect, useState } from 'react';
import { LayoutDashboard, PenTool, BookOpen, Users, Settings, LogOut, User as UserIcon, Menu, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { getSettings, saveSettings, parseJwt, GOOGLE_CLIENT_ID } from '../services/storageService';
import { AppSettings } from '../types';

declare global {
  interface Window {
    google: any;
  }
}

const NavItem = ({ to, icon: Icon, label, active, onClick }: { to: string, icon: any, label: string, active: boolean, onClick?: () => void }) => (
  <Link 
    to={to} 
    onClick={onClick}
    className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
      active 
        ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30' 
        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
    }`}
  >
    <Icon size={20} />
    <span className="font-medium">{label}</span>
  </Link>
);

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
     setSettings(getSettings());
  }, [location.pathname]);

  // Google Login Initialization
  useEffect(() => {
    const handleCredentialResponse = (response: any) => {
      const userObject = parseJwt(response.credential);
      
      if (userObject) {
        const currentSettings = getSettings();
        const updatedSettings: AppSettings = {
          ...currentSettings,
          adminProfile: {
            name: userObject.name,
            role: currentSettings.adminProfile.role || 'Editor Chefe',
            photoUrl: userObject.picture,
            email: userObject.email,
            googleId: userObject.sub
          }
        };
        
        saveSettings(updatedSettings);
        setSettings(updatedSettings);
        window.location.reload();
      }
    };

    if (window.google) {
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleCredentialResponse,
        auto_select: false
      });

      const btn = document.getElementById('googleSignInBtn');
      // Render only if button exists and user is NOT logged in
      if (btn && !settings?.adminProfile.email) {
          try {
            window.google.accounts.id.renderButton(
                btn,
                { 
                    theme: "outline", 
                    size: "large", 
                    type: "standard",
                    shape: "rectangular",
                    text: "signin_with",
                    logo_alignment: "left",
                    width: "220" // Fixed width to fit sidebar
                }
            );
          } catch (e) {
              console.error("GSI render error", e);
          }
      }
    }
  }, [settings?.adminProfile.email, isMobileMenuOpen]); // Re-run when menu opens on mobile to ensure button renders

  const handleLogout = () => {
    const currentSettings = getSettings();
    const updatedSettings: AppSettings = {
      ...currentSettings,
      adminProfile: {
        name: 'Administrador',
        role: 'Editor',
        photoUrl: '',
        email: undefined,
        googleId: undefined
      }
    };
    saveSettings(updatedSettings);
    setSettings(updatedSettings);
    window.location.reload();
  };

  const toggleMobileMenu = () => setIsMobileMenuOpen(!isMobileMenuOpen);

  return (
    <div className="flex min-h-screen bg-slate-50">
      
      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-16 bg-white border-b border-slate-200 z-30 flex items-center justify-between px-4 shadow-sm">
         <div className="flex items-center gap-2">
            <button onClick={toggleMobileMenu} className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg">
                {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
            <span className="text-xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                ArtigoGênio
            </span>
         </div>
         {settings?.adminProfile.photoUrl && (
             <img src={settings.adminProfile.photoUrl} alt="Profile" className="w-8 h-8 rounded-full border border-slate-200" />
         )}
      </div>

      {/* Overlay for mobile menu */}
      {isMobileMenuOpen && (
          <div 
            className="fixed inset-0 bg-black/50 z-30 md:hidden backdrop-blur-sm"
            onClick={() => setIsMobileMenuOpen(false)}
          />
      )}

      {/* Sidebar (Desktop & Mobile Drawer) */}
      <aside className={`
          fixed top-0 bottom-0 left-0 w-64 bg-white border-r border-slate-200 z-40 transition-transform duration-300 ease-in-out flex flex-col
          ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} 
          md:translate-x-0 md:static md:h-screen md:sticky md:top-0
      `}>
        <div className="p-6 border-b border-slate-100 flex justify-between items-center">
          <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                ArtigoGênio
              </h1>
              <p className="text-xs text-slate-400 mt-1">SEO 2025 • E-E-A-T Ready</p>
          </div>
          {/* Close button inside drawer only on mobile */}
          <button onClick={() => setIsMobileMenuOpen(false)} className="md:hidden text-slate-400">
             <X size={20} />
          </button>
        </div>
        
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          <NavItem onClick={() => setIsMobileMenuOpen(false)} to="/" icon={LayoutDashboard} label="Dashboard" active={location.pathname === '/'} />
          <NavItem onClick={() => setIsMobileMenuOpen(false)} to="/new" icon={PenTool} label="Novo Artigo" active={location.pathname === '/new'} />
          <NavItem onClick={() => setIsMobileMenuOpen(false)} to="/library" icon={BookOpen} label="Biblioteca" active={location.pathname === '/library'} />
          <NavItem onClick={() => setIsMobileMenuOpen(false)} to="/authors" icon={Users} label="Autores" active={location.pathname === '/authors'} />
          <NavItem onClick={() => setIsMobileMenuOpen(false)} to="/settings" icon={Settings} label="Configurações" active={location.pathname === '/settings'} />
        </nav>

        <div className="p-4 border-t border-slate-100 flex flex-col gap-4">
          {settings?.adminProfile.email ? (
            <>
              <div className="flex items-center gap-3 px-2 py-1">
                 <div className="w-10 h-10 rounded-full bg-slate-100 overflow-hidden flex items-center justify-center shrink-0 border border-slate-200">
                    {settings.adminProfile.photoUrl ? (
                        <img src={settings.adminProfile.photoUrl} alt="Admin" className="w-full h-full object-cover" />
                    ) : (
                        <UserIcon size={18} className="text-slate-400" />
                    )}
                 </div>
                 <div className="overflow-hidden min-w-0">
                    <p className="text-sm font-bold text-slate-800 truncate" title={settings.adminProfile.name}>{settings.adminProfile.name}</p>
                    <p className="text-[10px] text-slate-500 truncate" title={settings.adminProfile.email}>{settings.adminProfile.email}</p>
                 </div>
              </div>
              
              <div 
                onClick={handleLogout}
                className="flex items-center gap-3 px-4 py-2 text-red-500 hover:bg-red-50 rounded-lg cursor-pointer transition text-sm"
              >
                <LogOut size={16} />
                <span className="font-medium">Sair</span>
              </div>
            </>
          ) : (
             <div className="flex flex-col items-center gap-2 pb-2 w-full">
                <p className="text-xs text-slate-500 mb-1 w-full text-center">Entre para salvar seu perfil</p>
                {/* Google Button Container - Centered and full width allowed */}
                <div className="w-full flex justify-center overflow-hidden">
                    <div id="googleSignInBtn" className="h-[40px]"></div>
                </div>
                <div className="text-[10px] text-slate-400 text-center mt-2 px-2 leading-tight">
                   Configure o Client ID em <br/><code className="bg-slate-100 px-1 rounded">storageService.ts</code>
                </div>
             </div>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 w-full md:w-auto pt-16 md:pt-0 min-w-0 overflow-x-hidden">
        {children}
      </main>
    </div>
  );
};