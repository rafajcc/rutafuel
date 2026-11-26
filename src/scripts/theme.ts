const button = document.querySelector<HTMLButtonElement>('[data-theme-toggle]');

button?.addEventListener('click', () => {
  const isDark = document.documentElement.classList.toggle('dark');
  try {
    localStorage.setItem('rf-theme', isDark ? 'dark' : 'light');
  } catch {
    // Sin almacenamiento el tema sigue funcionando durante la sesión.
  }
});
