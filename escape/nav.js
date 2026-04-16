// Sidebar: active page + mobile toggle
(function(){
  const path = location.pathname.replace(/\/$/,'');
  const page = path.substring(path.lastIndexOf('/')+1) || 'index.html';
  document.querySelectorAll('.sidebar-link, .sidebar-hub').forEach(a => {
    const href = a.getAttribute('href');
    if (href === page || (page === 'index.html' && (href === './' || href === 'index.html'))) {
      a.classList.add('active');
    }
  });
  const btn = document.querySelector('.menu-toggle');
  const sidebar = document.querySelector('.sidebar');
  if (btn && sidebar) {
    btn.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      btn.textContent = sidebar.classList.contains('open') ? '✕' : '☰';
    });
    document.querySelector('.main-content')?.addEventListener('click', () => {
      sidebar.classList.remove('open');
      btn.textContent = '☰';
    });
  }
})();
