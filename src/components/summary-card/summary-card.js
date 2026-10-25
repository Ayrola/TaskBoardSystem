import './summary-card.css';
export function createSummaryCard({ label, value, icon, href }) {
  const link=document.createElement('a');link.className='summary-card';link.href=href;
  const heading=document.createElement('span');heading.className='summary-card-label';
  const glyph=document.createElement('i');glyph.className=`bi bi-${icon}`;glyph.setAttribute('aria-hidden','true');
  heading.append(glyph,document.createTextNode(` ${label}`));
  const count=document.createElement('strong');count.className='summary-card-value';count.textContent=value.toLocaleString();
  const arrow=document.createElement('i');arrow.className='bi bi-arrow-up-right summary-card-arrow';arrow.setAttribute('aria-hidden','true');
  link.setAttribute('aria-label',`${label}: ${value.toLocaleString()}. View ${label.toLowerCase()}.`);
  link.append(heading,count,arrow);return link;
}
