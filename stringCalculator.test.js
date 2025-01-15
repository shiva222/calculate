const StringCalculator = require('./stringCalculator');

describe('String Calculator', () => {
  let calculator;

  beforeEach(() => {
    calculator = new StringCalculator();
  });

  test('should return 0 for an empty string', () => {
    expect(calculator.add("")).toBe(0);
  });

  test('should return the number itself for a single number', () => {
    expect(calculator.add("1")).toBe(1);
    expect(calculator.add("5")).toBe(5);
  });

  test('should return the sum of two numbers', () => {
    expect(calculator.add("1,2")).toBe(3);
  });

  test('should handle multiple numbers', () => {
    expect(calculator.add("1,2,3")).toBe(6);
  });

  test('should handle newlines as delimiters', () => {
    expect(calculator.add("1\n2,3")).toBe(6);
  });

  test('should handle custom delimiters', () => {
    expect(calculator.add("//;\n1;2")).toBe(3);
    expect(calculator.add("//|\n2|3|4")).toBe(9);
  });

  test('should throw an error for negative numbers', () => {
    expect(() => calculator.add("1,-2,3")).toThrow("negative numbers not allowed: -2");
    expect(() => calculator.add("1,-2,-3")).toThrow("negative numbers not allowed: -2, -3");
  });
});
