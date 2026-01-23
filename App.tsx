import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './components/Dashboard';
import { ArticleWizard } from './components/ArticleWizard';
import { AuthorsManager } from './components/AuthorsManager';
import { Library } from './components/Library';
import { Settings } from './components/Settings';

const App: React.FC = () => {
  return (
    <HashRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/new" element={<ArticleWizard />} />
          <Route path="/edit/:id" element={<ArticleWizard />} />
          <Route path="/library" element={<Library />} />
          <Route path="/authors" element={<AuthorsManager />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </HashRouter>
  );
};

export default App;