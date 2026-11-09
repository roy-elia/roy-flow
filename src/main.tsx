import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import './styles/pages.css';
import App from './App';
import { ScratchpadApp } from './pages/Scratchpad';
import { LiveNoteApp } from './pages/MeetingNote';
import { hydrate } from './store';

const which = new URLSearchParams(location.search).get('window');

hydrate()
  .catch((e) => console.error('could not load data', e))
  .finally(() => {
    createRoot(document.getElementById('root')!).render(<StrictMode>{which === 'scratchpad' ? <ScratchpadApp /> : which === 'livenote' ? <LiveNoteApp /> : <App />}</StrictMode>);
  });
