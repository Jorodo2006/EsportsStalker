import { useState } from 'react';
import { PageHeader, Tabs } from '@/components/ui';
import UsersTab from '@/views/admin/UsersTab';
import ActivityTab from '@/views/admin/ActivityTab';

type Tab = 'users' | 'activity';

// Administración: sólo la ven los administradores (el gateway y bets lo comprueban otra vez). Cada pestaña pide lo suyo al
// abrirse; no hay consultas periódicas
export default function AdminView() {
  const [tab, setTab] = useState<Tab>('users');
  return (
    <>
      <PageHeader title="Administración" subtitle="Cuentas de los usuarios y registro de lo que ocurre en la app" />
      <div className="mb-4">
        <Tabs value={tab} onChange={setTab} items={[{ value: 'users', label: 'Usuarios' }, { value: 'activity', label: 'Actividad' }]} />
      </div>
      {tab === 'users' && <UsersTab />}
      {tab === 'activity' && <ActivityTab />}
    </>
  );
}
