import {describe,expect,it} from 'vitest';
import {normaliseNetPackQuantity,NET_PACK_EVIDENCE} from './tesco-net-pack-quantity';
function source(){return {name:'Example Tuna 4 x 145g',quantity:{grams:408},quantityEvidence:undefined as string|undefined,identityDetails:{
  packSize:[{value:'408',units:'G'}],netContents:'4 x 145g ℮',drainedWeight:'4 x 102g'}};}
describe('explicit whole-pack net/drained reconciliation',()=>{
  it('projects the corroborated full pack without editing retained evidence',()=>{
    const p=source(),before=JSON.stringify(p),result=normaliseNetPackQuantity(p);
    expect(result.quantity).toEqual({grams:580});
    expect(result.quantityEvidence).toBe(NET_PACK_EVIDENCE);
    expect(JSON.stringify(p)).toBe(before);
    expect(normaliseNetPackQuantity(result)).toEqual(result);
  });
  it('retains exact single-can and kilogram evidence',()=>{
    const p={name:'Example Tomatoes 0.4kg',quantity:{grams:250},identityDetails:{
      packSize:[{value:'0.25',units:'KG'}],netContents:'400g e',drainedWeight:'250g'}};
    expect(normaliseNetPackQuantity(p).quantity).toEqual({grams:400});
  });
  it.each(['net','drained','structured','quantity','title','count','multiple title masses','multiple structured sizes','invalid value'])
    ('preserves the original quantity on an unsupported %s',change=>{
      const p=source();
      if(change==='net')p.identityDetails.netContents='4 x 140g';
      if(change==='drained')p.identityDetails.drainedWeight='4 x 100g';
      if(change==='structured')p.identityDetails.packSize[0].value='400';
      if(change==='quantity')p.quantity.grams=400;
      if(change==='title')p.name='Example Tuna';
      if(change==='count')p.name='Example Tuna 580g';
      if(change==='multiple title masses')p.name+=' 580g';
      if(change==='multiple structured sizes')p.identityDetails.packSize.push({value:'408',units:'G'});
      if(change==='invalid value')p.identityDetails.packSize[0].value='not a number';
      expect(normaliseNetPackQuantity(p)).toBe(p);
    });
  it('never replaces missing quantities or reconciles conflicting drained declarations',()=>{
    const p=source();
    expect(normaliseNetPackQuantity({...p,quantity:null}).quantity).toBeNull();
    const peas={name:'Example Peas 420g',quantity:{grams:302},identityDetails:{
      packSize:[{value:'302',units:'G'}],netContents:'420g e',drainedWeight:'293g'}};
    expect(normaliseNetPackQuantity(peas)).toBe(peas);
  });
});
