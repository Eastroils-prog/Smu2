import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom'
import { StoreProvider } from '../lib/store'
import { SignIn } from '../features/auth/SignIn'
import { AdminDashboard, AdminMessages, AdminTasks, PeopleList, PersonDetail } from '../features/admin/AdminPages'
import { MyDashboard, MyMessages, MyProfile, MyProgress, MyTasks } from '../features/participant/ParticipantPages'
import { Shell } from './Shell'

export function DemoApp() {
  return (
    <StoreProvider>
      {/* The sample version keeps its place in memory so it can run as one shared page. */}
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<SignIn />} />
          <Route path="/admin" element={<Shell forRole="admin" />}>
            <Route index element={<AdminDashboard />} />
            <Route path="people" element={<PeopleList />} />
            <Route path="people/:id" element={<PersonDetail />} />
            <Route path="messages" element={<AdminMessages />} />
            <Route path="messages/:id" element={<AdminMessages />} />
            <Route path="tasks" element={<AdminTasks />} />
          </Route>
          <Route path="/app" element={<Shell forRole="participant" />}>
            <Route index element={<MyDashboard />} />
            <Route path="tasks" element={<MyTasks />} />
            <Route path="messages" element={<MyMessages />} />
            <Route path="progress" element={<MyProgress />} />
            <Route path="profile" element={<MyProfile />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </MemoryRouter>
    </StoreProvider>
  )
}
