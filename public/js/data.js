/* Dados simulados do Studio Corte — fácil de editar */

const CORTES = [
  { id: 1, nome: "Fade médio", img: "https://images.unsplash.com/photo-1622286342621-4bd786c2447c?w=400&h=300&fit=crop" },
  { id: 2, nome: "Pompadour", img: "https://images.unsplash.com/photo-1503951914875-452466b2d363?w=400&h=300&fit=crop" },
  { id: 3, nome: "Undercut", img: "https://images.unsplash.com/photo-1599351431202-1e0f0137899a?w=400&h=300&fit=crop" },
  { id: 4, nome: "Buzz cut", img: "https://images.unsplash.com/photo-1621605815971-fbc98d665033?w=400&h=300&fit=crop" },
  { id: 5, nome: "Longo texturizado", img: "https://images.unsplash.com/photo-1519699047748-de8e457a634e?w=400&h=300&fit=crop" },
  { id: 6, nome: "Bob feminino", img: "https://images.unsplash.com/photo-1605497788044-5a32c7078486?w=400&h=300&fit=crop" },
];

const SERVICOS = [
  { id: 1, icon: "✂️", nome: "Corte Masculino", desc: "Corte clássico ou moderno + finalização. Inclui orientação de manutenção.", preco: "R$ 65" },
  { id: 2, icon: "🔥", nome: "Fade / Degradê", desc: "Degradê técnico limpo, com ou sem desenho. Resultado preciso.", preco: "R$ 75" },
  { id: 3, icon: "🧔", nome: "Barba + Contorno", desc: "Modelagem completa, alinhamento e toalha quente opcional.", preco: "R$ 45" },
  { id: 4, icon: "👩", nome: "Corte Feminino", desc: "Corte, texturização e finalização. Ideal para mudança de visual.", preco: "R$ 90" },
  { id: 5, icon: "🎨", nome: "Coloração / Luzes", desc: "Diagnóstico do fio + técnicas modernas. Orçamento sob consulta.", preco: "A partir de R$ 180" },
  { id: 6, icon: "🧒", nome: "Corte Infantil", desc: "Ambiente calmo e paciência. A partir de 3 anos.", preco: "R$ 50" },
];

const PRODUTOS = [
  { id: 1, nome: "Pomada Modeladora", preco: 45, img: "https://images.unsplash.com/photo-1626806787461-74be3d2e8e0e?w=300&h=300&fit=crop", estoque: 24 },
  { id: 2, nome: "Shampoo Anticaspa", preco: 35, img: "https://images.unsplash.com/photo-1556228578-0d85b1a4d571?w=300&h=300&fit=crop", estoque: 18 },
  { id: 3, nome: "Óleo para Barba", preco: 35, img: "https://images.unsplash.com/photo-1620916560693-0c0b0b0b0b0b?w=300&h=300&fit=crop", estoque: 12 },
  { id: 4, nome: "Kit Pente + Escova", preco: 55, img: "https://images.unsplash.com/photo-1522338242992-e1a54906a8da?w=300&h=300&fit=crop", estoque: 9 },
];

const COMENTARIOS = [
  { id: 1, nome: "Carlos Silva", avatar: "https://i.pravatar.cc/100?u=1", servico: "Degradê Americano", nota: 5, texto: "Melhor corte que já fiz. O João entendeu exatamente o que eu queria e o resultado ficou impecável.", tempo: "Há 2 dias" },
  { id: 2, nome: "Ana Santos", avatar: "https://i.pravatar.cc/100?u=2", servico: "Hidratação Capilar", nota: 5, texto: "Ambiente super agradável e a Ana Hair é excelente. Saí renovada!", tempo: "Há 5 dias" },
  { id: 3, nome: "Pedro Oliveira", avatar: "https://i.pravatar.cc/100?u=3", servico: "Corte + Barba", nota: 4, texto: "Profissionais muito atenciosos. Voltarei com certeza.", tempo: "Há 1 semana" },
  { id: 4, nome: "Maria Costa", avatar: "https://i.pravatar.cc/100?u=4", servico: "Coloração", nota: 5, texto: "A coloração ficou do jeito que eu sonhava. Recomendo demais!", tempo: "Há 3 dias" },
  { id: 5, nome: "Bruno Souza", avatar: "https://i.pravatar.cc/100?u=5", servico: "Fade Médio", nota: 5, texto: "Precisão absurda no degradê. O melhor da região.", tempo: "Há 4 dias" },
];

const AGENDAMENTOS = [
  { hora: "09:00", cliente: "Carlos Silva", servico: "Corte + Barba", profissional: "João Barbeiro", status: "CONFIRMADO" },
  { hora: "10:00", cliente: "Ana Santos", servico: "Hidratação Capilar", profissional: "Ana Hair", status: "EM ESPERA" },
  { hora: "11:15", cliente: "Pedro Oliveira", servico: "Degradê Americano", profissional: "Pedro Stylist", status: "CONFIRMADO" },
  { hora: "13:30", cliente: "Maria Costa", servico: "Corte Social", profissional: "João Barbeiro", status: "EM ESPERA" },
  { hora: "14:15", cliente: "Bruno Souza", servico: "Barba Completa", profissional: "Pedro Stylist", status: "PENDENTE" },
  { hora: "15:00", cliente: "Ricardo Reis", servico: "Fade Médio", profissional: "João Barbeiro", status: "CONFIRMADO" },
];

/* Simulação de usuário logado (localStorage) */
function getUser() {
  try {
    return JSON.parse(localStorage.getItem("sc_user"));
  } catch {
    return null;
  }
}

function setUser(user) {
  localStorage.setItem("sc_user", JSON.stringify(user));
}

function logout() {
  localStorage.removeItem("sc_user");
  window.location.href = "index.html";
}

/* Carrinho */
function getCart() {
  try {
    return JSON.parse(localStorage.getItem("sc_cart")) || [];
  } catch {
    return [];
  }
}

function saveCart(cart) {
  localStorage.setItem("sc_cart", JSON.stringify(cart));
}

function addToCart(produtoId) {
  const cart = getCart();
  const existing = cart.find(i => i.id === produtoId);
  if (existing) {
    existing.qtd += 1;
  } else {
    const p = PRODUTOS.find(x => x.id === produtoId);
    if (p) cart.push({ id: p.id, nome: p.nome, preco: p.preco, qtd: 1 });
  }
  saveCart(cart);
  return cart;
}

function removeFromCart(produtoId) {
  let cart = getCart().filter(i => i.id !== produtoId);
  saveCart(cart);
  return cart;
}
