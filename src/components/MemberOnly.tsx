// Lo que pide cuenta (las recomendaciones del modelo, las apuestas, la cartera, los amigos): a quien navega sin ella se le
// explica qué tendría y se le ofrece crearla o entrar. El servidor tampoco lo da sin sesión (gateway/public.js): esto es sólo
// para que no vea un error
import type { ComponentType, ReactNode } from 'react';
import { cn } from '@/lib/format';
import { askLogin, useMember } from './AuthGate';
import { Button, panelCls } from './ui';

const PERKS = 'Crear una cuenta es gratis: tendrás las recomendaciones del modelo, tu registro de apuestas con la cartera, y podrás hablar con tus amigos y pasaros apuestas.';

// what: lo que no se ve, en minúscula («las recomendaciones del modelo»); compact: para las bandas al lado de la lista
export function JoinPrompt({ what, compact, className }: { what: string; compact?: boolean; className?: string }) {
  const why = `Para ver ${what} hace falta una cuenta.`;
  return (
    <div className={cn(panelCls, compact ? 'px-4 py-3.5' : 'px-5 py-6 sm:px-6', className)}>
      <div className={cn('font-semibold text-zinc-50', compact ? 'text-[13px]' : 'text-[15px]')}>{why}</div>
      <p className={cn('mt-1 text-zinc-400', compact ? 'text-xs' : 'max-w-xl text-sm')}>{PERKS}</p>
      <div className={cn('flex flex-wrap gap-2', compact ? 'mt-3' : 'mt-4')}>
        <Button size={compact ? 'sm' : 'md'} onClick={() => askLogin({ mode: 'register', why })}>Crear cuenta</Button>
        <Button size={compact ? 'sm' : 'md'} variant="secondary" onClick={() => askLogin({ mode: 'login', why })}>Entrar</Button>
      </div>
    </div>
  );
}

export function MemberOnly({ what, compact, children }: { what: string; compact?: boolean; children: ReactNode }) {
  return useMember() ? <>{children}</> : <JoinPrompt what={what} compact={compact} />;
}

// Envuelve un componente: sin cuenta, el aviso en su lugar (y sus consultas ni se lanzan)
export function memberOnly<P extends object>(C: ComponentType<P>, what: string, compact?: boolean) {
  const Wrapped = (p: P) => <MemberOnly what={what} compact={compact}><C {...p} /></MemberOnly>;
  Wrapped.displayName = `MemberOnly(${C.displayName || C.name})`;
  return Wrapped;
}
