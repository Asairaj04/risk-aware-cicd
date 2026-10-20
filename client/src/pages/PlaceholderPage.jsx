import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

export default function PlaceholderPage({ title, description }) {
  return (
    <section className="content-page">
      <div className="page-intro">
        <p className="eyebrow">ANALYSIS MODULE</p>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>

      <div className="content-card empty-state">
        <h3>This module is ready for integration.</h3>
        <p>
          We will connect this page to the corresponding backend
          endpoints in the next development steps. Results will be
          shown only when actual application data is available.
        </p>
        <Link to="/repositories" className="text-link">
          Go to repositories <ArrowRight size={16} />
        </Link>
      </div>
    </section>
  );
}