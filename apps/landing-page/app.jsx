function App() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <TryIt />
        <Problem />
        <Features />
        <Demo />
      </main>
      <Footer />
    </>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
