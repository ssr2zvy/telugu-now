import type {ReaderSwipe} from './reader-swipe';
export class ReaderWheel {
  private last=-Infinity;
  private total=0;
  private used=false;
  private axis='';
  private sign=0;
  move(dx:number,dy:number,mode:number,height:number,now:number):ReaderSwipe|null {
    if(!Number.isFinite(dx)||!Number.isFinite(dy)||(!dx&&!dy))return null;
    const axis=Math.abs(dx)>Math.abs(dy)?'x':'y';
    const value=(axis==='x'?dx:dy)*(mode===1?16:mode===2?height:1);
    const sign=Math.sign(value);
    if(now-this.last>200 || this.axis!==axis || this.sign!==sign){this.total=0;this.used=false;}
    this.last=now;this.axis=axis;this.sign=sign;
    if(this.used)return null;
    this.total+=value;
    if(Math.abs(this.total)<48)return null;
    this.used=true;
    return axis==='x'?(value>0?'next':'back'):(value>0?'down':'up');
  }
}
