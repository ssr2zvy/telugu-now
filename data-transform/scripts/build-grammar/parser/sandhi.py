"""Reversible Unicode boundary edits for registered compound members.

Only boundaries listed on the receiving object are available. Neither direction
accepts an arbitrary substring as a lexeme; Engine replays both lexical sides.
"""
CONSONANTS = set('కఖగఘఙచఛజఝఞటఠడఢణతథదధనపఫబభమయరలవశషసహళఱ')

def left_matches(text, boundary):
    tail=boundary['left_tail']
    if tail and not text.endswith(tail):return False
    if boundary.get('left_class')=='inherent_a':return bool(text) and text[-1] in CONSONANTS
    if boundary.get('left_class')=='voiced_virama':
        return len(text)>=2 and text[-1]=='్' and text[-2] in set('గఘజఝడఢదధబభఙఞణనమయరలవహళఱ')
    return True

def plain_concat_allowed(left,right):
    if not right or right[0] not in CONSONANTS:return False
    voiced=set('గఘజఝడఢదధబభఙఞణనమయరలవహళఱ')
    # An unimplemented consonant sandhi is unknown, never an unconditioned concat.
    if len(left)>=2 and left.endswith('్') and left[-2] in set('కఖచఛటఠతథపఫశషస') and right[0] in voiced:return False
    return True

def join(left,right,boundaries,allowed):
    for bid in allowed:
        b=boundaries[bid]
        if not left_matches(left,b) or not right.startswith(b['right_head']):continue
        prefix=left[:-len(b['left_tail'])] if b['left_tail'] else left
        return prefix+b['replacement']+right[len(b['right_head']):],bid
    # Plain concatenation is available only at a consonant-initial boundary.
    if plain_concat_allowed(left,right):return left+right,'consonant_concat'
    raise ValueError('unregistered_compound_boundary')

def split(word,right,boundaries):
    if right and right[0] in CONSONANTS and word.endswith(right):
        yield word[:-len(right)],'consonant_concat'
    for bid,b in boundaries.items():
        if not right.startswith(b['right_head']):continue
        tail=b['replacement']+right[len(b['right_head']):]
        if not tail or not word.endswith(tail):continue
        left=word[:-len(tail)]+b['left_tail']
        if left_matches(left,b):yield left,bid
