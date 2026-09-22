import React from 'react';

interface LogoProps {
  className?: string;
}

/** The Fyllo brand mark. Source: public/fyllo-mark.png (from the FylloAI brand kit). */
const Logo = ({ className = 'w-8 h-8' }: LogoProps) => (
  <img src="/fyllo-mark.png" alt="Fyllo" className={className} />
);

export default Logo;
