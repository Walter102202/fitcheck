import { BrowserRouter, Route, Routes } from 'react-router';
import { AppConfigProvider } from './api/config.js';
import { ApiProvider } from './api/context.js';
import type { FitcheckApi } from './api/types.js';
import { Layout } from './layout/Layout.js';
import { NotFound } from './layout/NotFound.js';
import { CapScreen } from './screens/cap/CapScreen.js';
import { SimulatedApprovalScreen } from './screens/cap/SimulatedApprovalScreen.js';
import { HomeScreen } from './screens/home/HomeScreen.js';
import { ResultsScreen } from './screens/results/ResultsScreen.js';
import { RunScreen } from './screens/run/RunScreen.js';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/cap" element={<CapScreen />} />
        <Route path="/cap/approve-simulated" element={<SimulatedApprovalScreen />} />
        <Route path="/run/:scenarioId" element={<RunScreen />} />
        <Route path="/results" element={<ResultsScreen />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

export function App({ api }: { api: FitcheckApi }) {
  return (
    <BrowserRouter>
      <ApiProvider api={api}>
        <AppConfigProvider>
          <AppRoutes />
        </AppConfigProvider>
      </ApiProvider>
    </BrowserRouter>
  );
}
