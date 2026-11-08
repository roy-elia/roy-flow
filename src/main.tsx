import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import './styles/pages.css';
import App from './App';
import { ScratchpadApp } from './pages/Scratchpad';
import { hydrate } from './store';

const isScratchpad = new URLSearchParams(location.search).get('window') === 'scratchpad';

hydrate()
  .catch((e) => console.error('could not load data', e))
  .finally(() => {
    createRoot(document.getElementById('root')!).render(<StrictMode>{isScratchpad ? <ScratchpadApp /> : <App />}</StrictMode>);
  });
