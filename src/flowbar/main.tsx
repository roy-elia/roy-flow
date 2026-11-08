import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/tokens.css';
import './flowbar.css';
import './flowbar-window.css';
import NativeFlowBar from './NativeFlowBar';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NativeFlowBar />
  </StrictMode>,
);
