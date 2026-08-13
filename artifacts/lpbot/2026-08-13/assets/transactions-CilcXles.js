import{p as f,k as a,l as p,j as d}from"./AppKitProvider-nVcOIkXs.js";import"./index-D0FmPqGc.js";import"./http-CqmYNlLj.js";import"./parseUnits-CN82zxnQ.js";const u=f`
  :host > wui-flex:first-child {
    height: 500px;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: none;
  }

  :host > wui-flex:first-child::-webkit-scrollbar {
    display: none;
  }
`;var w=function(n,t,i,o){var l=arguments.length,e=l<3?t:o===null?o=Object.getOwnPropertyDescriptor(t,i):o,r;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")e=Reflect.decorate(n,t,i,o);else for(var s=n.length-1;s>=0;s--)(r=n[s])&&(e=(l<3?r(e):l>3?r(t,i,e):r(t,i))||e);return l>3&&e&&Object.defineProperty(t,i,e),e};let c=class extends a{render(){return p`
      <wui-flex flexDirection="column" .padding=${["0","3","3","3"]} gap="3">
        <w3m-activity-list page="activity"></w3m-activity-list>
      </wui-flex>
    `}};c.styles=u;c=w([d("w3m-transactions-view")],c);export{c as W3mTransactionsView};
