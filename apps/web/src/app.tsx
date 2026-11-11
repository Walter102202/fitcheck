import { BrowserRouter, Route, Routes } from 'react-router';

function Home() {
  return (
    <main className="wrap">
      <h1>Fitcheck</h1>
    </main>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
    </BrowserRouter>
  );
}
