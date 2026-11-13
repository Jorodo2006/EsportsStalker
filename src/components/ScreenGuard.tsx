// Si una pantalla falla al pintarse, React desmonta la app entera y se queda en negro. Esto la encierra: sale un aviso con
// «Reintentar» en su sitio y el resto (menú, cupón, directo) sigue funcionando. Se reinicia al cambiar de pantalla o de deporte
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './ui';

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ScreenGuard extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('La pantalla ha fallado:', error, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <AlertTriangle size={22} className="text-rose-400" />
        <div className="text-sm font-medium text-zinc-100">Esta pantalla ha fallado</div>
        <p className="max-w-md text-xs text-zinc-500">{this.state.error.message}</p>
        <Button variant="secondary" size="sm" onClick={() => this.setState({ error: null })}>Reintentar</Button>
      </div>
    );
  }
}
