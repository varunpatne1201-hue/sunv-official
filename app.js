const toast = document.getElementById('toast');
let toastTimer;
for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    const value = button.getAttribute('data-copy');
    try {
      await navigator.clipboard.writeText(value);
      button.textContent = 'Copied';
      toast.textContent = 'SUNV contract copied';
      toast.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toast.classList.remove('show');
        button.textContent = button.classList.contains('wide') ? 'Copy address' : 'Copy';
      }, 1800);
    } catch {
      window.prompt('Copy the SUNV contract address:', value);
    }
  });
}
