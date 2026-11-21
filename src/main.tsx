import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import '@fontsource-variable/geist'
import './index.css'
import { installPublicToasts } from './lib/publicToasts'

// No raw database or network error reaches a pop-up, whatever code raised it.
installPublicToasts()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
