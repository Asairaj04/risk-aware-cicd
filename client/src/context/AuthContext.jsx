import {
    createContext,
    useContext,
    useEffect,
    useState,
  } from "react";
  import api from "../api/api";
  
  const AuthContext = createContext(null);
  
  export function AuthProvider({ children }) {
    const [token, setToken] = useState(
      () => sessionStorage.getItem("cicd_token")
    );
  
    const [user, setUser] = useState(() => {
      try {
        const savedUser = sessionStorage.getItem("cicd_user");
        return savedUser ? JSON.parse(savedUser) : null;
      } catch {
        return null;
      }
    });
  
    const [isLoading, setIsLoading] = useState(true);
  
    useEffect(() => {
      const existingToken = sessionStorage.getItem("cicd_token");
  
      if (!existingToken) {
        setIsLoading(false);
        return;
      }
  
      api
        .get("/api/auth/me")
        .then((response) => {
          setUser(response.data.user);
          sessionStorage.setItem(
            "cicd_user",
            JSON.stringify(response.data.user)
          );
        })
        .catch(() => {
          sessionStorage.removeItem("cicd_token");
          sessionStorage.removeItem("cicd_user");
          setToken(null);
          setUser(null);
        })
        .finally(() => setIsLoading(false));
    }, []);
  
    async function login(email, password) {
      const response = await api.post("/api/auth/login", {
        email,
        password,
      });
  
      const { token: newToken, user: loggedInUser } = response.data;
  
      if (!newToken || !loggedInUser) {
        throw new Error("The server returned an invalid login response.");
      }
  
      sessionStorage.setItem("cicd_token", newToken);
      sessionStorage.setItem(
        "cicd_user",
        JSON.stringify(loggedInUser)
      );
  
      setToken(newToken);
      setUser(loggedInUser);
  
      return response.data;
    }
  
    async function register(name, email, password) {
      const response = await api.post("/api/auth/register", {
        name,
        email,
        password,
      });
  
      return response.data;
    }
  
    function logout() {
      sessionStorage.removeItem("cicd_token");
      sessionStorage.removeItem("cicd_user");
      setToken(null);
      setUser(null);
    }
  
    return (
      <AuthContext.Provider
        value={{
          user,
          token,
          isLoading,
          isAuthenticated: Boolean(token && user),
          login,
          register,
          logout,
        }}
      >
        {children}
      </AuthContext.Provider>
    );
  }
  
  export function useAuth() {
    const context = useContext(AuthContext);
  
    if (!context) {
      throw new Error("useAuth must be used within AuthProvider.");
    }
  
    return context;
  }