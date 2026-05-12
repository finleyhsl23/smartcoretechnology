function setupPremiumHeader() {
  const header = document.querySelector(".site-header");

  if (!header) return;

  const updateHeader = () => {
    header.classList.toggle("scrolled", window.scrollY > 40);
  };

  updateHeader();
  window.addEventListener("scroll", updateHeader);
}

function setupScrollReveal() {
  const revealItems = document.querySelectorAll(".scroll-reveal");

  if (!revealItems.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.14
    }
  );

  revealItems.forEach((item) => observer.observe(item));
}

setupPremiumHeader();
setupScrollReveal();
