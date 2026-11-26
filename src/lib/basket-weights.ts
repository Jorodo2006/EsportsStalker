// Cuánto pesa hoy el modelo de baloncesto frente a la casa: lo reajusta el servidor cada día con los resultados
// (server/services/bets/tuning.js). Se aplica a todo lo que calcula (recomendaciones, analizador, escáner y puntos de equipo) con
// setPlayerWeight y setTeamWeight, y devuelve una clave que cambia cuando cambian, para recalcular lo que ya estaba calculado.
// Sin sesión o sin respuesta, los de siempre (0,3 y 0,25)
import { useQuery } from '@tanstack/react-query';
import { useMember } from '@/components/AuthGate';
import { setPlayerWeight } from './basket-model';
import { setTeamWeight } from './basket-teams';

export function useBasketWeights(): string {
  const member = useMember();
  const q = useQuery({ queryKey: ['bets', 'model-weights'], queryFn: () => window.api.bets.modelWeights(), enabled: member, staleTime: 60 * 60e3, retry: false });
  const d = q.data;
  if (d) { setPlayerWeight(d.player); setTeamWeight(d.team); }
  return d ? `${d.player}|${d.team}` : 'base';
}
