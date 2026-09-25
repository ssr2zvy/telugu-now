import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
export function ParserSection({title,summary,children,open=false}:{title:string;summary?:string;children:ReactNode;open?:boolean}) {
  return <details className="parser-section" open={open}>
    <summary><span>{title}{summary ? <small>{summary}</small> : null}</span><ChevronDown size={18} aria-hidden="true"/></summary>
    <div className="parser-section-body">{children}</div>
  </details>;
}
