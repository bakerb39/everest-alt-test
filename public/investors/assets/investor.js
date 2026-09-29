/* Everest ALT investor docs — shared behavior */
document.documentElement.className += ' js';
(function(){
  // Theme toggle (persists)
  var KEY='ealt-theme';
  function apply(t){ if(t){document.documentElement.setAttribute('data-theme',t);} }
  try{ apply(localStorage.getItem(KEY)); }catch(e){}
  window.addEventListener('DOMContentLoaded',function(){
    var btn=document.getElementById('themeToggle');
    if(btn){
      btn.addEventListener('click',function(){
        var cur=document.documentElement.getAttribute('data-theme');
        var next = cur==='dark' ? 'light' : (cur==='light' ? 'dark' :
          (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'light':'dark'));
        document.documentElement.setAttribute('data-theme',next);
        try{ localStorage.setItem(KEY,next); }catch(e){}
      });
    }
    // year
    document.querySelectorAll('[data-year]').forEach(function(el){ el.textContent=new Date().getFullYear(); });
    // reveal on scroll
    if('IntersectionObserver' in window){
      var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}});},{threshold:0.1,rootMargin:'0px 0px -6% 0px'});
      document.querySelectorAll('.reveal').forEach(function(el){io.observe(el);});
    } else {
      document.querySelectorAll('.reveal').forEach(function(el){el.classList.add('in');});
    }
  });
})();
