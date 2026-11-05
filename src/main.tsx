import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppProvider } from '@/lib/app-context';
import { api } from '@/lib/api';
import { AuthGate } from '@/components/AuthGate';
import App from './App';
import './index.css';

window.api = api;

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 } }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthGate>
        <AppProvider>
          <App />
        </AppProvider>
      </AuthGate>
    </QueryClientProvider>
  </StrictMode>
);
