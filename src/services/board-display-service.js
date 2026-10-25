const key='taskboard:board-display';
export function readBoardDisplay() {
 let value={};try{value=JSON.parse(localStorage.getItem(key))??{};}catch{/* Optional storage. */}
 return {density:value.density==='compact'?'compact':'comfortable',descriptions:value.descriptions!==false};
}
export function saveBoardDisplay(value) {try{localStorage.setItem(key,JSON.stringify(value));}catch{/* Keep current-page settings. */}}
export const BOARD_DISPLAY_KEY=key;
