import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import { SocialOverlay } from './SocialOverlay';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{location.hash==='#social-overlay'?<SocialOverlay />:<App />}</React.StrictMode>,
);
