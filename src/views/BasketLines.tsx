// Baloncesto · Líneas: el escáner con los partidos que aún no han empezado.
import { useState } from 'react';
import { ArrowLeft, CalendarX } from 'lucide-react';
import { BasketAnalyzer, type Picked } from '@/components/BasketAnalyzer';
import { BasketLineScanner } from '@/components/BasketLineScanner';
import { useBasketOdds } from '@/components/BasketOdds';
import { RangeFilters, useUpcomingGames } from '@/components/BasketRange';
import { Empty, ErrorBox, Loading } from '@/components/ui';
import { cn } from '@/lib/format';
import type { BasketInjury } from '@/lib/types';

export default function BasketLines() {
  const u = useUpcomingGames();
  const [picked, setPicked] = useState<Picked | null>(null);
  return (
    <>
      {picked && <PickedPlayer player={picked} injuries={u.injuries} onBack={() => setPicked(null)} />}
      <div className={cn('flex flex-col gap-2.5', picked && 'hidden')}>
        <RangeFilters u={u} />
        {u.loading ? <Loading label="Cargando partidos…" /> : u.error ? <ErrorBox error={u.error} /> : !u.games.length
          ? <Empty icon={<CalendarX size={26} />}>No quedan partidos por empezar en ese intervalo. Prueba con otro día.</Empty>
          : <BasketLineScanner games={u.games} injuries={u.injuries} onPick={setPicked} />}
      </div>
    </>
  );
}

function PickedPlayer({ player, injuries, onBack }: { player: Picked; injuries: BasketInjury[]; onBack: () => void }) {
  const odds = useBasketOdds(player.game!);
  return (
    <div className="flex flex-col gap-3">
      <button onClick={onBack} className="flex w-fit cursor-pointer items-center gap-1.5 text-[13px] text-zinc-400 transition hover:text-zinc-100"><ArrowLeft size={15} />Volver a la lista</button>
      <BasketAnalyzer key={`${player.league}:${player.id}:${player.market}:${player.line}`} player={player} games={[player.game!]} injuries={injuries} odds={odds.data} />
    </div>
  );
}
