import { TestBed } from '@angular/core/testing';
import { AudioAnalyzer } from './audio-analyzer.service';


describe('AudioAnalyzer', () => {
  let service: AudioAnalyzer;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AudioAnalyzer);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
