"use client";

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { User, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "./firebase";
import { UserProfile, UserRole } from "./types";

const IS_DEV = process.env.NODE_ENV === "development";

const DEV_PROFILES: Record<UserRole, UserProfile> = {
  admin:       { uid: "dev-admin",   email: "admin@dev.local",   role: "admin",       nombre: "Admin Dev",       createdAt: new Date(), activo: true },
  despachador: { uid: "dev-desp",    email: "desp@dev.local",    role: "despachador", nombre: "Despachador Dev", createdAt: new Date(), activo: true },
  chofer:      { uid: "dev-chofer",  email: "0001@chofer.dev",   role: "chofer",      nombre: "Chofer Dev", ficha: "0001", createdAt: new Date(), activo: true },
  encargado:   { uid: "dev-enc",     email: "enc@dev.local",     role: "encargado",   nombre: "Encargado Dev",   createdAt: new Date(), activo: true },
};

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  devLogin?: (role: UserRole) => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null, profile: null, loading: true,
  login: async () => {}, logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const devActiveRef = useRef(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (devActiveRef.current) return;
      if (firebaseUser) {
        const snap = await getDoc(doc(db, "usuarios", firebaseUser.uid));
        if (snap.exists()) {
          const data = snap.data() as UserProfile;
          // Bloquear choferes dados de baja
          if (data.activo === false) {
            await signOut(auth);
            setUser(null);
            setProfile(null);
            setLoading(false);
            return;
          }
          setProfile(data);
        }
        setUser(firebaseUser);
      } else {
        setUser(null);
        setProfile(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const login = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const devLogin = IS_DEV
    ? (role: UserRole) => {
        devActiveRef.current = true;
        setProfile(DEV_PROFILES[role]);
        setUser({ uid: `dev-${role}`, email: DEV_PROFILES[role].email } as unknown as User);
        setLoading(false);
      }
    : undefined;

  const logout = async () => {
    if (devActiveRef.current) {
      devActiveRef.current = false;
      setUser(null);
      setProfile(null);
      return;
    }
    await signOut(auth);
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, login, logout, devLogin }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
