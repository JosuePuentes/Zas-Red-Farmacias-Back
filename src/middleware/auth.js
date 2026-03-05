import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const JWT_SECRET = process.env.JWT_SECRET || 'secret';

export function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    req.role = decoded.role;
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.role)) {
      return res.status(403).json({ error: 'Sin permiso para esta acción' });
    }
    next();
  };
}

export async function attachUser(req, res, next) {
  if (!req.userId) return next();
  try {
    const user = await User.findById(req.userId)
      .select('-password')
      .populate('farmaciaId');
    req.user = user;
    next();
  } catch {
    next();
  }
}
