-- Novo perfil de acesso (separado porque o valor não pode ser usado na mesma transação em que é criado).
ALTER TYPE "TipoPerfil" ADD VALUE IF NOT EXISTS 'RECEPCIONISTA';
