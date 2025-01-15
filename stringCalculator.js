class StringCalculator {
    add(numbers) {
        if (!numbers) {
            return 0;
        }

        const defaultDelimiters = [',', '\n'];
        let customDelimiter = null;
        if (numbers.startsWith("//")) {
            const [delimiterLine, remainingNumbers] = numbers.split('\n', 2);
            customDelimiter = delimiterLine.slice(2);
            numbers = remainingNumbers;
        }

        const delimiters = customDelimiter
            ? [...defaultDelimiters, customDelimiter]
            : defaultDelimiters;

        const delimiterRegex = new RegExp(`[${delimiters.join('')}]`);
        const numberList = numbers.split(delimiterRegex).map(num => parseInt(num, 10));
        const negativeNumbers = numberList.filter(num => num < 0);
        if (negativeNumbers.length > 0) {
            throw new Error(`negative numbers not allowed: ${negativeNumbers.join(', ')}`);
        }
        return numberList.reduce((sum, num) => sum + (isNaN(num) ? 0 : num), 0);
    }
}

module.exports = StringCalculator;
