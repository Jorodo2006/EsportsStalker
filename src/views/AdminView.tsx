import { useState } from 'react';
import { PageHeader, Tabs } from '@/components/ui';
import UsersTab from '@/views/admin/UsersTab';
import ActivityTab from '@/views/admin/ActivityTab';
import ModelTab from '@/views/admin/ModelTab';

type Tab = 'users' | 'activity' | 'model';

// Administración: sólo la ven los administradores (el gateway y bets lo comprueban otra vez). Cada pestaña pide lo suyo al
// abrirse; no hay consultas periódicas
export default function AdminView() {
  const [tab, setTab] = useState<Tab>('users');
  return (
    <>
      <PageHeader title="Administración" subtitle="Cuentas de los usuarios, registro de lo que ocurre en la app y acierto del modelo" />
      <div className="mb-4">
        <Tabs value={tab} onChange={setTab} items={[{ value: 'users', label: 'Usuarios' }, { value: 'activity', label: 'Actividad' }, { value: 'model', label: 'Acierto del modelo' }]} />
      </div>
      {tab === 'users' && <UsersTab />}
      {tab === 'activity' && <ActivityTab />}
      {tab === 'model' && <ModelTab />}
    </>
  );
}
