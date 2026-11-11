document.addEventListener("DOMContentLoaded", () => {
  // Mobile menu
  const toggle = document.getElementById("mobileToggle");
  const nav = document.getElementById("mainNav");
  if (toggle && nav) {
    toggle.addEventListener("click", () => nav.classList.toggle("open"));
  }

  // Auth state no header
  const user = getUser();
  const btnLogin = document.getElementById("btnLogin");
  if (user && btnLogin) {
    btnLogin.textContent = user.nome.split(" ")[0];
    btnLogin.href = "perfil.html";
    // Se for admin, mostrar link admin
    if (user.role === "admin") {
      const adminLink = document.createElement("a");
      adminLink.href = "admin/index.html";
      adminLink.className = "btn btn-outline btn-sm";
      adminLink.textContent = "Painel";
      btnLogin.parentNode.insertBefore(adminLink, btnLogin);
    }
  }

  // Render Cortes
  const cortesGrid = document.getElementById("cortesGrid");
  if (cortesGrid) {
    cortesGrid.innerHTML = CORTES.map(c => `
      <article class="corte-card">
        <img src="${c.img}" alt="${c.nome}" loading="lazy" onerror="this.src='https://placehold.co/400x300/1a1a24/71717a?text=Corte'">
        <div class="info"><h3>${c.nome}</h3></div>
      </article>
    `).join("");
  }

  // Render Serviços
  const servicosGrid = document.getElementById("servicosGrid");
  if (servicosGrid) {
    servicosGrid.innerHTML = SERVICOS.map(s => `
      <article class="servico-card">
        <div class="icon">${s.icon}</div>
        <h3>${s.nome}</h3>
        <p>${s.desc}</p>
        <div class="preco">${s.preco}</div>
      </article>
    `).join("");
  }

  // Render Produtos (só se houver)
  const produtosSection = document.getElementById("produtos");
  const produtosGrid = document.getElementById("produtosGrid");
  if (PRODUTOS.length > 0 && produtosSection && produtosGrid) {
    produtosSection.style.display = "block";
    produtosGrid.innerHTML = PRODUTOS.map(p => `
      <article class="produto-card">
        <img src="${p.img}" alt="${p.nome}" loading="lazy" onerror="this.src='https://placehold.co/300x300/1a1a24/71717a?text=Produto'">
        <div class="info">
          <h3>${p.nome}</h3>
          <div class="preco">R$ ${p.preco.toFixed(2)}</div>
          <button class="btn btn-primary btn-sm" onclick="addProdutoCarrinho(${p.id})">Adicionar</button>
        </div>
      </article>
    `).join("");
  }

  // Render Comentários (primeiros 3)
  const comentariosGrid = document.getElementById("comentariosGrid");
  if (comentariosGrid) {
    const mostrar = COMENTARIOS.slice(0, 3);
    comentariosGrid.innerHTML = mostrar.map(c => `
      <article class="comentario-card">
        <div class="comentario-header">
          <img class="avatar" src="${c.avatar}" alt="${c.nome}">
          <div>
            <div class="name">${c.nome}</div>
            <div class="meta">${c.servico} · ${c.tempo}</div>
          </div>
        </div>
        <div class="stars">${"★".repeat(c.nota)}${"☆".repeat(5 - c.nota)}</div>
        <p>${c.texto}</p>
      </article>
    `).join("");
  }

  // Ver todos comentários
  const btnTodos = document.getElementById("btnVerTodosComentarios");
  if (btnTodos && comentariosGrid) {
    let expandido = false;
    btnTodos.addEventListener("click", () => {
      expandido = !expandido;
      const lista = expandido ? COMENTARIOS : COMENTARIOS.slice(0, 3);
      comentariosGrid.innerHTML = lista.map(c => `
        <article class="comentario-card">
          <div class="comentario-header">
            <img class="avatar" src="${c.avatar}" alt="${c.nome}">
            <div>
              <div class="name">${c.nome}</div>
              <div class="meta">${c.servico} · ${c.tempo}</div>
            </div>
          </div>
          <div class="stars">${"★".repeat(c.nota)}${"☆".repeat(5 - c.nota)}</div>
          <p>${c.texto}</p>
        </article>
      `).join("");
      btnTodos.textContent = expandido ? "Ver menos" : "Ver todos os comentários";
    });
  }
});

function addProdutoCarrinho(id) {
  const user = getUser();
  if (!user) {
    alert("Faça login para adicionar produtos ao carrinho.");
    window.location.href = "login.html";
    return;
  }
  addToCart(id);
  alert("Produto adicionado ao carrinho!");
}
