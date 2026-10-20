import { Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";
import AppLayout from "./components/layout/AppLayout";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Repositories from "./pages/Repositories";
import PlaceholderPage from "./pages/PlaceholderPage";
import PullRequests from "./pages/PullRequests";
import RiskAnalysis from "./pages/RiskAnalysis";
import RecommendedOrder from "./pages/RecommendedOrder";
import Workflows from "./pages/Workflows";
import FailureDiagnosis from "./pages/FailureDiagnosis";
import History from "./pages/History";
import DependencyManagement from "./pages/DependencyManagement";
import "./App.css";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<Dashboard />} />

          <Route path="repositories" element={<Repositories />} />

          <Route
              path="pull-requests"
              element={<PullRequests />}
          />

          <Route
            path="workflows"
            element={<Workflows />}
          />

          <Route
            path="diagnosis"
            element={<FailureDiagnosis />}
          />

          <Route
            path="risk-analysis"
            element={<RiskAnalysis />}
          />

          <Route
            path="sequencing"
            element={<RecommendedOrder />}
          />

          <Route
            path="/dependencies"
            element={<DependencyManagement />}
          />


          <Route
           path="/history" 
          element={<History />} 
          />


        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}